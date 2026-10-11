import { supabase } from './supabase';

const DEFAULT_MEMBERS = ['You', 'Mom'];

const DEFAULT_CATEGORIES = [
  { name: 'Fruits', kind: 'expense', icon: '🍎' },
  { name: 'Groceries', kind: 'expense', icon: '🛒' },
  { name: 'Electricity', kind: 'expense', icon: '💡' },
  { name: 'Miscellaneous', kind: 'expense', icon: '🧾' },
  { name: 'Emergency Fund', kind: 'saving', icon: '🛟' },
] as const;

export async function initializeHousehold() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error('Please sign in first.');

  const members = DEFAULT_MEMBERS.map((name) => ({
    owner_id: user.id,
    name,
  }));

  const { error: memberError } = await supabase
    .from('members')
    .upsert(members, { onConflict: 'owner_id,name', ignoreDuplicates: true });

  if (memberError) throw memberError;

  const categories = DEFAULT_CATEGORIES.map((category) => ({
    owner_id: user.id,
    ...category,
  }));

  const { error: categoryError } = await supabase
    .from('categories')
    .upsert(categories, {
      onConflict: 'owner_id,name,kind',
      ignoreDuplicates: true,
    });

  if (categoryError) throw categoryError;
}