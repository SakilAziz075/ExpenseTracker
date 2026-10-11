import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addCategory,
  deleteCategory,
  getAllCategories,
  renameCategory,
  setCategoryActive,
  type Category,
} from '../lib/transactions';

type Props = {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
};

type CategoryKind = 'expense' | 'saving';

const COLORS = {
  bg: '#F7F8F4',
  card: '#FFFFFF',
  green: '#28543B',
  dark: '#20382D',
  muted: '#7C8A80',
  pale: '#E7EFE4',
  border: '#E8ECE5',
  red: '#B94C43',
};

function iconForCategory(name: string): keyof typeof Ionicons.glyphMap {
  const value = name.toLowerCase();
  if (value.includes('fruit') || value.includes('vegetable')) return 'nutrition-outline';
  if (value.includes('grocer') || value.includes('food') || value.includes('edible')) return 'cart-outline';
  if (value.includes('electric') || value.includes('utilit') || value.includes('bill')) return 'flash-outline';
  if (value.includes('transport') || value.includes('fuel')) return 'car-outline';
  if (value.includes('medical') || value.includes('health')) return 'medkit-outline';
  if (value.includes('rent') || value.includes('home')) return 'home-outline';
  if (value.includes('invest')) return 'trending-up-outline';
  if (value.includes('emergency')) return 'shield-checkmark-outline';
  if (value.includes('saving')) return 'wallet-outline';
  if (value.includes('misc')) return 'ellipsis-horizontal-circle-outline';
  return 'pricetag-outline';
}

export default function CategoryManager({ visible, onClose, onChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await getAllCategories());
    } catch (error) {
      Alert.alert(
        'Could not load categories',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void loadCategories();
  }, [visible, loadCategories]);

  async function handleAdd() {
    if (!name.trim()) {
      Alert.alert('Category name required', 'Enter a name for this category.');
      return;
    }

    setSaving(true);
    try {
      await addCategory(name, kind);
      setName('');
      await loadCategories();
      onChanged();
      Alert.alert('Category added', `"${name.trim()}" is now available.`);
    } catch (error) {
      Alert.alert(
        'Could not add category',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(category: Category) {
    if (!editingName.trim()) {
      Alert.alert('Category name required', 'Enter a name before saving.');
      return;
    }

    setSaving(true);
    try {
      await renameCategory(category.id, editingName);
      setEditingId(null);
      setEditingName('');
      await loadCategories();
      onChanged();
    } catch (error) {
      Alert.alert(
        'Could not rename category',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(category: Category) {
    Alert.alert(
      'Delete category permanently?',
      `Delete "${category.name}"? Categories linked to existing transactions cannot be deleted, so your history stays intact. If this category has been used, deactivate it instead.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                await deleteCategory(category.id, category.name);
                await loadCategories();
                onChanged();
                Alert.alert('Category deleted', `"${category.name}" was deleted.`);
              } catch (error) {
                Alert.alert(
                  'Could not delete category',
                  error instanceof Error ? error.message : 'Please try again.',
                );
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ],
    );
  }

  function confirmToggle(category: Category) {
    const nextActive = !category.is_active;
    Alert.alert(
      nextActive ? 'Reactivate category?' : 'Deactivate category?',
      nextActive
        ? `"${category.name}" will be available for new entries again.`
        : `"${category.name}" will be hidden for new entries. Existing transactions and history will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Reactivate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                await setCategoryActive(category.id, nextActive);
                await loadCategories();
                onChanged();
              } catch (error) {
                Alert.alert(
                  'Could not update category',
                  error instanceof Error ? error.message : 'Please try again.',
                );
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ],
    );
  }

  const shownCategories = categories.filter((category) => category.kind === kind);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PERSONALIZE YOUR LEDGER</Text>
            <Text style={styles.title}>Manage categories</Text>
            <Text style={styles.subtitle}>Rename or deactivate categories without losing history.</Text>
          </View>
          <Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Close category manager">
            <Ionicons name="close" size={23} color={COLORS.dark} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.kindSwitch}>
            <Pressable
              style={[styles.kindButton, kind === 'expense' && styles.kindButtonActive]}
              onPress={() => { setKind('expense'); setEditingId(null); }}
            >
              <Ionicons name="receipt-outline" size={17} color={kind === 'expense' ? '#FFFFFF' : COLORS.green} />
              <Text style={[styles.kindText, kind === 'expense' && styles.kindTextActive]}>Expenses</Text>
            </Pressable>
            <Pressable
              style={[styles.kindButton, kind === 'saving' && styles.kindButtonActive]}
              onPress={() => { setKind('saving'); setEditingId(null); }}
            >
              <Ionicons name="wallet-outline" size={17} color={kind === 'saving' ? '#FFFFFF' : COLORS.green} />
              <Text style={[styles.kindText, kind === 'saving' && styles.kindTextActive]}>Savings</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Add a category</Text>
          <View style={styles.addRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={kind === 'expense' ? 'e.g. Transport' : 'e.g. Fixed deposit'}
              placeholderTextColor="#9AA59B"
              maxLength={40}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => void handleAdd()}
            />
            <Pressable
              style={[styles.addButton, saving && styles.disabled]}
              onPress={() => void handleAdd()}
              disabled={saving}
              accessibilityLabel="Add category"
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="add" size={23} color="#FFFFFF" />}
            </Pressable>
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>{kind === 'expense' ? 'Expense categories' : 'Savings categories'}</Text>
            <Text style={styles.count}>{shownCategories.length}</Text>
          </View>

          {loading ? (
            <View style={styles.loading}><ActivityIndicator size="large" color={COLORS.green} /></View>
          ) : shownCategories.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="pricetags-outline" size={26} color={COLORS.muted} />
              <Text style={styles.emptyText}>No categories yet. Add one above.</Text>
            </View>
          ) : shownCategories.map((category) => (
            <View key={category.id} style={[styles.categoryRow, !category.is_active && styles.inactiveRow]}>
              <View style={styles.categoryIcon}>
                <Ionicons name={iconForCategory(category.name)} size={19} color={category.is_active ? COLORS.green : COLORS.muted} />
              </View>
              <View style={styles.categoryBody}>
                {editingId === category.id ? (
                  <TextInput
                    value={editingName}
                    onChangeText={setEditingName}
                    autoFocus
                    maxLength={40}
                    style={styles.renameInput}
                    returnKeyType="done"
                    onSubmitEditing={() => void handleRename(category)}
                  />
                ) : (
                  <>
                    <Text style={[styles.categoryName, !category.is_active && styles.inactiveText]}>{category.name}</Text>
                    <Text style={styles.categoryStatus}>{category.is_active ? 'Active' : 'Inactive · history preserved'}</Text>
                  </>
                )}
              </View>

              {editingId === category.id ? (
                <>
                  <Pressable style={styles.iconButton} onPress={() => void handleRename(category)} accessibilityLabel="Save category name">
                    <Ionicons name="checkmark" size={20} color={COLORS.green} />
                  </Pressable>
                  <Pressable style={styles.iconButton} onPress={() => { setEditingId(null); setEditingName(''); }} accessibilityLabel="Cancel rename">
                    <Ionicons name="close" size={20} color={COLORS.muted} />
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={styles.iconButton}
                    onPress={() => { setEditingId(category.id); setEditingName(category.name); }}
                    accessibilityLabel={`Rename ${category.name}`}
                  >
                    <Ionicons name="create-outline" size={18} color={COLORS.green} />
                  </Pressable>
                  <Pressable
                    style={styles.iconButton}
                    onPress={() => confirmToggle(category)}
                    accessibilityLabel={`${category.is_active ? 'Deactivate' : 'Reactivate'} ${category.name}`}
                  >
                    <Ionicons
                      name={category.is_active ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color={category.is_active ? COLORS.red : COLORS.green}
                    />
                  </Pressable>
                  <Pressable
                    style={[styles.iconButton, styles.deleteIconButton]}
                    onPress={() => confirmDelete(category)}
                    accessibilityLabel={`Delete ${category.name}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                  </Pressable>
                </>
              )}
            </View>
          ))}

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.green} />
            <Text style={styles.noteText}>You can permanently delete a category if it has never been used. Categories linked to existing transactions cannot be deleted; deactivate those instead to preserve your history.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingHorizontal: 21, paddingTop: 22, paddingBottom: 17,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  eyebrow: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: COLORS.dark, fontSize: 24, fontWeight: '800', marginTop: 5 },
  subtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 4, maxWidth: 280 },
  closeButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  kindSwitch: { flexDirection: 'row', backgroundColor: '#E9EDE6', borderRadius: 13, padding: 4, gap: 5 },
  kindButton: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10 },
  kindButtonActive: { backgroundColor: COLORS.green },
  kindText: { color: COLORS.green, fontSize: 13, fontWeight: '800' },
  kindTextActive: { color: '#FFFFFF' },
  sectionTitle: { color: COLORS.dark, fontSize: 15, fontWeight: '800' },
  addRow: { flexDirection: 'row', gap: 9, marginTop: 12, marginBottom: 24 },
  input: { flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.dark, fontSize: 14 },
  addButton: { width: 48, borderRadius: 12, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  count: { color: COLORS.green, backgroundColor: COLORS.pale, borderRadius: 9, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  loading: { paddingVertical: 35, alignItems: 'center' },
  empty: { paddingVertical: 30, alignItems: 'center', gap: 8 },
  emptyText: { color: COLORS.muted, fontSize: 12 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 10, marginBottom: 8 },
  inactiveRow: { opacity: 0.72 },
  categoryIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' },
  categoryBody: { flex: 1, minWidth: 0 },
  categoryName: { color: COLORS.dark, fontSize: 13, fontWeight: '800' },
  inactiveText: { color: COLORS.muted },
  categoryStatus: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  renameInput: { borderWidth: 1, borderColor: '#C7D9C5', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, color: COLORS.dark, fontSize: 13 },
  iconButton: { width: 33, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F2F5F0' },
  deleteIconButton: { backgroundColor: '#FBEDEA' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: COLORS.pale, borderRadius: 13, padding: 13, marginTop: 16 },
  noteText: { flex: 1, color: COLORS.dark, fontSize: 11, lineHeight: 17 },
});
