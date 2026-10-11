import {
  cacheDelete,
  cacheUpsert,
  getCachedSnapshot,
  isOnlineNow,
  makeLocalId,
  syncPendingChanges,
} from "./offlineSync";
import { supabase } from "./supabase";

export type TransactionType =
  | "income"
  | "expense"
  | "saving_deposit"
  | "saving_withdrawal";
export type Member = { id: string; name: string };
export type Category = {
  id: string;
  name: string;
  kind: "expense" | "saving";
  icon: string | null;
  is_active: boolean;
  owner_id?: string;
  created_at?: string;
};
export type NewTransaction = {
  member_id: string;
  category_id?: string | null;
  type: TransactionType;
  amount: number;
  occurred_on: string;
  note?: string;
};

async function getCurrentUserId() {
  // getSession reads the persisted local session; unlike getUser, it does not
  // need to validate the session against the server on every call.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user)
    throw new Error("Please sign in while online before using offline mode.");
  return user.id;
}

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /network|fetch failed|failed to fetch|timeout|timed out|connection|offline|socket/i.test(
    message,
  );
}

async function fallbackSnapshot(ownerId: string) {
  const snapshot = await getCachedSnapshot(ownerId);
  if (!snapshot)
    throw new Error(
      "No cached household data is available. Connect to the internet once, then offline support will be ready.",
    );
  return snapshot;
}

export async function getMembers(): Promise<Member[]> {
  const ownerId = await getCurrentUserId();
  if (await isOnlineNow()) {
    try {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, owner_id, created_at")
        .eq("owner_id", ownerId)
        .order("created_at");
      if (error) throw error;
      const rows = (data ?? []) as Member[];
      // Cache the refreshed members while retaining the other cached tables.
      const { cacheRows } = await import("./offlineSync");
      await cacheRows(ownerId, "members", data ?? []);
      return rows;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  return (await fallbackSnapshot(ownerId)).members as Member[];
}

export async function getCategories(
  kind?: "expense" | "saving",
  includeInactive = false,
): Promise<Category[]> {
  const ownerId = await getCurrentUserId();
  if (await isOnlineNow()) {
    try {
      let query = supabase
        .from("categories")
        .select("id, name, kind, icon, is_active, owner_id, created_at")
        .eq("owner_id", ownerId)
        .order("name");
      if (!includeInactive) query = query.eq("is_active", true);
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) throw error;
      const { cacheRows } = await import("./offlineSync");
      // Cache all categories (including inactive) so historical labels remain available.
      const { data: allData, error: allError } = await supabase
        .from("categories")
        .select("id, name, kind, icon, is_active, owner_id, created_at")
        .eq("owner_id", ownerId)
        .order("name");
      if (!allError) await cacheRows(ownerId, "categories", allData ?? []);
      return (data ?? []) as Category[];
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const snapshot = await fallbackSnapshot(ownerId);
  return (snapshot.categories as Category[]).filter(
    (category) =>
      (!kind || category.kind === kind) &&
      (includeInactive || category.is_active),
  );
}

function validateTransaction(input: NewTransaction) {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error("Enter an amount greater than zero.");
  if (input.type !== "income" && !input.category_id)
    throw new Error("Select a category.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurred_on)) {
    throw new Error("Enter a valid date in YYYY-MM-DD format.");
  }

  // Validate in UTC so local time zones cannot shift the date during ISO conversion.
  const [year, month, day] = input.occurred_on.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Enter a real calendar date.");
  }
}

export async function addTransaction(input: NewTransaction) {
  const ownerId = await getCurrentUserId();
  validateTransaction(input);
  const payload = {
    id: makeLocalId(),
    owner_id: ownerId,
    member_id: input.member_id,
    category_id: input.category_id ?? null,
    type: input.type,
    amount: input.amount,
    occurred_on: input.occurred_on,
    note: input.note?.trim() || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (await isOnlineNow()) {
    try {
      const { data, error } = await supabase
        .from("transactions")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      await cacheUpsert(
        ownerId,
        "transactions",
        data as Record<string, unknown>,
      );
      return data;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheUpsert(ownerId, "transactions", payload, true);
  return { ...payload, pendingSync: true };
}

export async function updateTransaction(
  transactionId: string,
  input: NewTransaction,
) {
  const ownerId = await getCurrentUserId();
  validateTransaction(input);
  const current = await fallbackSnapshot(ownerId);
  const previous = current.transactions.find((tx) => tx.id === transactionId);
  if (!previous)
    throw new Error(
      "This transaction is not in the offline cache. Connect to the internet and try again.",
    );
  const payload = {
    ...previous,
    id: transactionId,
    owner_id: ownerId,
    member_id: input.member_id,
    category_id: input.category_id ?? null,
    type: input.type,
    amount: input.amount,
    occurred_on: input.occurred_on,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (await isOnlineNow()) {
    try {
      const { data, error } = await supabase
        .from("transactions")
        .update({
          member_id: payload.member_id,
          category_id: payload.category_id,
          type: payload.type,
          amount: payload.amount,
          occurred_on: payload.occurred_on,
          note: payload.note,
          updated_at: payload.updated_at,
        })
        .eq("id", transactionId)
        .eq("owner_id", ownerId)
        .select()
        .single();
      if (error) throw error;
      await cacheUpsert(
        ownerId,
        "transactions",
        data as Record<string, unknown>,
      );
      return data;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheUpsert(ownerId, "transactions", payload, true);
  return { ...payload, pendingSync: true };
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const ownerId = await getCurrentUserId();
  if (await isOnlineNow()) {
    try {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", transactionId)
        .eq("owner_id", ownerId);
      if (error) throw error;
      await cacheDelete(ownerId, "transactions", transactionId);
      return;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  const snapshot = await fallbackSnapshot(ownerId);
  if (!snapshot.transactions.some((tx) => tx.id === transactionId))
    throw new Error("This transaction is not in the offline cache.");
  await cacheDelete(ownerId, "transactions", transactionId, true);
}

export async function getAllCategories(): Promise<Category[]> {
  return getCategories(undefined, true);
}

export async function addCategory(
  name: string,
  kind: "expense" | "saving",
): Promise<Category> {
  const ownerId = await getCurrentUserId();
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Enter a category name.");
  if (cleanName.length > 40)
    throw new Error("Category names must be 40 characters or fewer.");
  const existing = (await fallbackSnapshot(ownerId)).categories as Category[];
  if (
    existing.some(
      (item) =>
        item.kind === kind &&
        item.name.toLowerCase() === cleanName.toLowerCase(),
    )
  ) {
    throw new Error(
      `A ${kind === "expense" ? "expense" : "savings"} category with this name already exists.`,
    );
  }
  const payload: Category = {
    id: makeLocalId(),
    owner_id: ownerId,
    name: cleanName,
    kind,
    icon: "pricetag-outline",
    is_active: true,
    created_at: new Date().toISOString(),
  };
  if (await isOnlineNow()) {
    try {
      const { data, error } = await supabase
        .from("categories")
        .insert(payload)
        .select("id, name, kind, icon, is_active, owner_id, created_at")
        .single();
      if (error) throw error;
      await cacheUpsert(ownerId, "categories", data as Record<string, unknown>);
      return data as Category;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheUpsert(
    ownerId,
    "categories",
    payload as unknown as Record<string, unknown>,
    true,
  );
  return payload;
}

export async function renameCategory(
  categoryId: string,
  name: string,
): Promise<Category> {
  const ownerId = await getCurrentUserId();
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Enter a category name.");
  if (cleanName.length > 40)
    throw new Error("Category names must be 40 characters or fewer.");
  const snapshot = await fallbackSnapshot(ownerId);
  const current = (snapshot.categories as Category[]).find(
    (item) => item.id === categoryId,
  );
  if (!current) throw new Error("Category not found in the offline cache.");
  if (
    (snapshot.categories as Category[]).some(
      (item) =>
        item.id !== categoryId &&
        item.kind === current.kind &&
        item.name.toLowerCase() === cleanName.toLowerCase(),
    )
  )
    throw new Error("A category with this name and type already exists.");
  const payload = { ...current, name: cleanName };
  if (await isOnlineNow()) {
    try {
      const { data, error } = await supabase
        .from("categories")
        .update({ name: cleanName })
        .eq("id", categoryId)
        .eq("owner_id", ownerId)
        .select("id, name, kind, icon, is_active, owner_id, created_at")
        .single();
      if (error) throw error;
      await cacheUpsert(ownerId, "categories", data as Record<string, unknown>);
      return data as Category;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheUpsert(
    ownerId,
    "categories",
    payload as unknown as Record<string, unknown>,
    true,
  );
  return payload;
}

export async function setCategoryActive(
  categoryId: string,
  isActive: boolean,
): Promise<void> {
  const ownerId = await getCurrentUserId();
  const snapshot = await fallbackSnapshot(ownerId);
  const current = (snapshot.categories as Category[]).find(
    (item) => item.id === categoryId,
  );
  if (!current) throw new Error("Category not found in the offline cache.");
  const payload = { ...current, is_active: isActive };
  if (await isOnlineNow()) {
    try {
      const { error } = await supabase
        .from("categories")
        .update({ is_active: isActive })
        .eq("id", categoryId)
        .eq("owner_id", ownerId);
      if (error) throw error;
      await cacheUpsert(
        ownerId,
        "categories",
        payload as unknown as Record<string, unknown>,
      );
      return;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheUpsert(
    ownerId,
    "categories",
    payload as unknown as Record<string, unknown>,
    true,
  );
}

export async function deleteCategory(
  categoryId: string,
  categoryName: string,
): Promise<void> {
  const ownerId = await getCurrentUserId();
  const snapshot = await fallbackSnapshot(ownerId);
  if (snapshot.transactions.some((tx) => tx.category_id === categoryId)) {
    throw new Error(
      `"${categoryName}" is used by existing transactions. To preserve your history, deactivate this category instead of deleting it.`,
    );
  }
  if (await isOnlineNow()) {
    try {
      const { data: linkedTransactions, error: linkedError } = await supabase
        .from("transactions")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("category_id", categoryId)
        .limit(1);
      if (linkedError) throw linkedError;
      if (linkedTransactions?.length)
        throw new Error(
          `"${categoryName}" is used by existing transactions. Deactivate it instead.`,
        );
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", categoryId)
        .eq("owner_id", ownerId);
      if (error) throw error;
      await cacheDelete(ownerId, "categories", categoryId);
      return;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
    }
  }
  await cacheDelete(ownerId, "categories", categoryId, true);
}

export async function syncOfflineChanges(): Promise<number> {
  const ownerId = await getCurrentUserId();
  return syncPendingChanges(ownerId);
}
