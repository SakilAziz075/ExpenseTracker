import { useEffect, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';

import {
  addTransaction,
  updateTransaction,
  getCategories,
  getMembers,
  type Category,
  type Member,
  type TransactionType,
} from '../lib/transactions';

type EditableTransaction = {
  id: string;
  member_id: string;
  category_id: string | null;
  type: TransactionType;
  amount: number | string;
  occurred_on: string;
  note: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  transaction?: EditableTransaction | null;
};

const TYPES: {
  label: string;
  value: TransactionType;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { label: 'Expense', value: 'expense', icon: 'receipt-outline' },
  { label: 'Income', value: 'income', icon: 'cash-outline' },
  { label: 'Savings deposit', value: 'saving_deposit', icon: 'arrow-down-circle-outline' },
  { label: 'Savings withdrawal', value: 'saving_withdrawal', icon: 'arrow-up-circle-outline' },
];

function localDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateKey(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function categoryIcon(name: string): keyof typeof Ionicons.glyphMap {
  const value = name.trim().toLowerCase();

  if (/fruit|vegetable|produce/.test(value)) return 'nutrition-outline';
  if (/grocery|groceries|food|edible|market/.test(value)) return 'cart-outline';
  if (/electric|power|utility|utilities|bill/.test(value)) return 'flash-outline';
  if (/transport|travel|fuel|petrol|cab/.test(value)) return 'car-outline';
  if (/medical|health|medicine|pharmacy/.test(value)) return 'medkit-outline';
  if (/rent|home|house|maintenance/.test(value)) return 'home-outline';
  if (/education|book|school|course/.test(value)) return 'book-outline';
  if (/shopping|clothes|purchase/.test(value)) return 'bag-handle-outline';
  if (/emergency/.test(value)) return 'shield-checkmark-outline';
  if (/investment|invest/.test(value)) return 'trending-up-outline';
  if (/saving|savings|deposit/.test(value)) return 'wallet-outline';
  if (/misc|other/.test(value)) return 'ellipsis-horizontal-circle-outline';

  return 'pricetag-outline';
}

export default function TransactionForm({ visible, onClose, onSaved, transaction = null }: Props) {
  const [type, setType] = useState<TransactionType>('expense');
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [memberId, setMemberId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDateString());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    async function loadFormData() {
      setLoading(true);
      try {
        const [loadedMembers, loadedCategories] = await Promise.all([
          getMembers(),
          getCategories(),
        ]);

        if (cancelled) return;
        setMembers(loadedMembers);
        setCategories(loadedCategories);

        if (transaction) {
          setType(transaction.type);
          setMemberId(transaction.member_id);
          setCategoryId(transaction.category_id ?? '');
          setAmount(String(transaction.amount));
          setDate(transaction.occurred_on);
          const transactionDate = dateFromKey(transaction.occurred_on);
          setCalendarMonth(new Date(transactionDate.getFullYear(), transactionDate.getMonth(), 1));
          setNote(transaction.note ?? '');
        } else {
          setType('expense');
          setMemberId((current) =>
            loadedMembers.some((member) => member.id === current)
              ? current
              : loadedMembers[0]?.id ?? '',
          );
          setCategoryId('');
          setAmount('');
          const todayKey = localDateString();
          setDate(todayKey);
          const todayDate = dateFromKey(todayKey);
          setCalendarMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
          setNote('');
        }
      } catch (error) {
        if (!cancelled) {
          Alert.alert(
            'Could not load form',
            error instanceof Error ? error.message : 'Please try again.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFormData();
    return () => {
      cancelled = true;
    };
  }, [visible, transaction]);

  const categoryKind = useMemo<'expense' | 'saving' | null>(() => {
    if (type === 'expense') return 'expense';
    if (type === 'income') return null;
    return 'saving';
  }, [type]);

  const visibleCategories = categories.filter(
    (category) => category.kind === categoryKind,
  );

  useEffect(() => {
    if (!visibleCategories.some((category) => category.id === categoryId)) {
      setCategoryId('');
    }
  }, [type, categories]);

  function resetForm() {
    setType('expense');
    setAmount('');
    const todayKey = localDateString();
    setDate(todayKey);
    const todayDate = dateFromKey(todayKey);
    setCalendarMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
    setNote('');
    setCategoryId('');
  }

  async function handleSave() {
    const numericAmount = Number(amount.trim());

    if (!memberId) {
      Alert.alert('Select a person', 'Choose who this transaction belongs to.');
      return;
    }

    if (!amount.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter an amount greater than zero.');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Invalid date', 'Enter the date in YYYY-MM-DD format.');
      return;
    }

    const parsedDate = new Date(`${date}T00:00:00`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.getFullYear() !== Number(date.slice(0, 4)) ||
      parsedDate.getMonth() + 1 !== Number(date.slice(5, 7)) ||
      parsedDate.getDate() !== Number(date.slice(8, 10))
    ) {
      Alert.alert('Invalid date', 'Please enter a real calendar date.');
      return;
    }

    if (categoryKind && !categoryId) {
      Alert.alert('Select a category', 'Choose a category for this transaction.');
      return;
    }

    setSaving(true);
    try {
      const input = {
        member_id: memberId,
        category_id: categoryKind ? categoryId : null,
        type,
        amount: numericAmount,
        occurred_on: date,
        note,
      };

      const saved = transaction
        ? await updateTransaction(transaction.id, input)
        : await addTransaction(input);
      const pendingSync = Boolean((saved as { pendingSync?: boolean }).pendingSync);

      resetForm();
      onClose();
      onSaved();
      Alert.alert(
        pendingSync ? 'Saved on this phone' : transaction ? 'Transaction updated' : 'Transaction saved',
        pendingSync
          ? 'Your entry is stored locally and will sync to your household account when the internet returns.'
          : transaction
            ? 'Your changes have been synchronized successfully.'
            : 'Your entry has been synchronized successfully.',
      );
    } catch (error) {
      Alert.alert(
        'Could not save transaction',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>HOUSEHOLD FINANCES</Text>
            <Text style={styles.title}>{transaction ? 'Edit transaction' : 'Add transaction'}</Text>
            <Text style={styles.subtitle}>Record it once. Keep everything in sync.</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close transaction form"
          >
            <Ionicons name="close" size={22} color="#244B35" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#287A52" />
            <Text style={styles.muted}>Loading members and categories…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Transaction type</Text>
            <View style={styles.typeGrid}>
              {TYPES.map((item) => {
                const selected = type === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => setType(item.value)}
                    style={[styles.typeButton, selected && styles.selectedButton]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.typeIconWrap, selected && styles.selectedIconWrap]}>
                      <Ionicons
                        name={item.icon}
                        size={19}
                        color={selected ? '#287A52' : '#758477'}
                      />
                    </View>
                    <Text style={[styles.typeText, selected && styles.selectedText]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>Who does this belong to?</Text>
            {members.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={22} color="#758477" />
                <Text style={styles.muted}>No household members found. Reopen the dashboard to initialize your household.</Text>
              </View>
            ) : (
              <View style={styles.row}>
                {members.map((member) => {
                  const selected = memberId === member.id;
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => setMemberId(member.id)}
                      style={[styles.personButton, selected && styles.selectedButton]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <View style={[styles.personIconWrap, selected && styles.selectedIconWrap]}>
                        <Ionicons
                          name="person-outline"
                          size={21}
                          color={selected ? '#287A52' : '#758477'}
                        />
                      </View>
                      <Text style={[styles.personText, selected && styles.selectedText]}>
                        {member.name}
                      </Text>
                      {selected && (
                        <Ionicons name="checkmark-circle" size={17} color="#287A52" />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.label}>Amount</Text>
            <View style={styles.amountWrap}>
              <Text style={styles.currency}>₹</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor="#A3ADA5"
                keyboardType="decimal-pad"
                style={styles.amountInput}
                accessibilityLabel="Transaction amount in rupees"
              />
            </View>

            <View style={styles.dateHeading}>
              <Text style={styles.labelNoMargin}>Date</Text>
              <View style={styles.selectedDatePill}>
                <Ionicons name="calendar-outline" size={14} color="#28543B" />
                <Text style={styles.selectedDateText}>{date}</Text>
              </View>
            </View>

            <View style={styles.dateInputWrap}>
              <Ionicons name="create-outline" size={18} color="#758477" />
              <TextInput
                value={date}
                onChangeText={(value) => {
                  setDate(value);
                  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    const parsed = dateFromKey(value);
                    if (
                      !Number.isNaN(parsed.getTime()) &&
                      formatDateKey(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) === value
                    ) {
                      setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
                    }
                  }
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#A3ADA5"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={styles.dateInput}
                accessibilityLabel="Transaction date in YYYY-MM-DD format"
              />
            </View>
            <Text style={styles.dateHint}>Type a date above or select a day from the calendar.</Text>

            <View style={styles.formCalendar}>
              <View style={styles.formCalendarHeader}>
                <Pressable
                  style={styles.calendarArrow}
                  onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  accessibilityLabel="Previous month"
                >
                  <Ionicons name="chevron-back" size={18} color="#294735" />
                </Pressable>
                <Text style={styles.formCalendarMonth}>
                  {calendarMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </Text>
                <Pressable
                  style={styles.calendarArrow}
                  onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  accessibilityLabel="Next month"
                >
                  <Ionicons name="chevron-forward" size={18} color="#294735" />
                </Pressable>
              </View>

              <View style={styles.formWeekdays}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => (
                  <Text
                    key={`${weekday}-${index}`}
                    style={[styles.formWeekday, index >= 5 && styles.formWeekendText]}
                  >
                    {weekday}
                  </Text>
                ))}
              </View>

              <View style={styles.formCalendarGrid}>
                {[
                  ...Array((new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() + 6) % 7).fill(null),
                  ...Array.from(
                    { length: new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate() },
                    (_, index) => index + 1,
                  ),
                ].map((day, index) => {
                  if (day === null) {
                    return <View key={`empty-${index}`} style={styles.formDayCell} />;
                  }

                  const key = formatDateKey(calendarMonth.getFullYear(), calendarMonth.getMonth(), day as number);
                  const weekday = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day as number).getDay();
                  const isWeekend = weekday === 0 || weekday === 6;
                  const selected = key === date;
                  const isToday = key === localDateString();

                  return (
                    <Pressable
                      key={key}
                      onPress={() => setDate(key)}
                      style={[
                        styles.formDayCell,
                        isWeekend && styles.formWeekendCell,
                        isToday && styles.formTodayCell,
                        selected && styles.formDaySelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={key}
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[
                          styles.formDayText,
                          isWeekend && styles.formWeekendDayText,
                          isToday && styles.formTodayText,
                          selected && styles.formDaySelectedText,
                        ]}
                      >
                        {day}
                      </Text>
                      {isToday && !selected && <View style={styles.todayMarker} />}
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.calendarLegend}>
                <View style={styles.weekendLegendDot} />
                <Text style={styles.calendarLegendText}>Weekend</Text>
                <View style={styles.todayLegendDot} />
                <Text style={styles.calendarLegendText}>Today</Text>
              </View>
            </View>

            {categoryKind && (
              <>
                <View style={styles.labelRow}>
                  <Text style={styles.labelNoMargin}>Category</Text>
                  <Text style={styles.optionalHint}>Select one</Text>
                </View>
                {visibleCategories.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="pricetag-outline" size={22} color="#758477" />
                    <Text style={styles.muted}>
                      No active categories. Category management can be added next.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.categoryGrid}>
                    {visibleCategories.map((category) => {
                      const selected = categoryId === category.id;
                      return (
                        <Pressable
                          key={category.id}
                          onPress={() => setCategoryId(category.id)}
                          style={[
                            styles.categoryButton,
                            selected && styles.selectedCategoryButton,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <View style={[styles.categoryIconWrap, selected && styles.selectedIconWrap]}>
                            <Ionicons
                              name={categoryIcon(category.name)}
                              size={20}
                              color={selected ? '#287A52' : '#647568'}
                            />
                          </View>
                          <Text
                            numberOfLines={2}
                            style={[styles.categoryText, selected && styles.selectedText]}
                          >
                            {category.name}
                          </Text>
                          {selected && (
                            <Ionicons name="checkmark-circle" size={16} color="#287A52" />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>Note <Text style={styles.optionalInline}>(optional)</Text></Text>
            <View style={[styles.inputWithIcon, styles.noteWrap]}>
              <Ionicons name="create-outline" size={19} color="#758477" style={styles.noteIcon} />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a short description"
                placeholderTextColor="#A3ADA5"
                style={[styles.inputText, styles.noteInput]}
                multiline
                textAlignVertical="top"
              />
            </View>

            <Pressable
              onPress={handleSave}
              disabled={saving || loading || members.length === 0}
              style={[
                styles.saveButton,
                (saving || members.length === 0) && styles.disabledButton,
              ]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.saveText}>{transaction ? 'Save changes' : 'Save transaction'}</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.secureNote}>
              <Ionicons name="cloud-done-outline" size={13} color="#718074" />{' '}
              Your entries sync across phones when online; offline entries are queued automatically
            </Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAF8F0' },
  header: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E9EDE6',
  },
  eyebrow: { color: '#64806D', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#193D2B', fontSize: 25, fontWeight: '800', marginTop: 5 },
  subtitle: { color: '#7D897F', fontSize: 12, marginTop: 5 },
  closeButton: {
    width: 40, height: 40, borderRadius: 13, backgroundColor: '#E9EEE5',
    alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: 22, paddingTop: 5, paddingBottom: 36 },
  label: { color: '#294735', fontSize: 14, fontWeight: '700', marginTop: 21, marginBottom: 10 },
  labelNoMargin: { color: '#294735', fontSize: 14, fontWeight: '700' },
  dateHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 21, marginBottom: 10 },
  selectedDatePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E7EFE4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  selectedDateText: { color: '#28543B', fontSize: 11, fontWeight: '800' },
  dateInputWrap: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EAE1', borderRadius: 12, paddingHorizontal: 13 },
  dateInput: { flex: 1, color: '#20382D', fontSize: 14, paddingVertical: 10 },
  dateHint: { color: '#7C8A80', fontSize: 11, marginTop: 6, marginBottom: 10 },
  formCalendar: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EAE1', borderRadius: 16, paddingHorizontal: 10, paddingTop: 11, paddingBottom: 10 },
  formCalendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  calendarArrow: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F2F5F0', alignItems: 'center', justifyContent: 'center' },
  formCalendarMonth: { color: '#20382D', fontSize: 14, fontWeight: '800' },
  formWeekdays: { flexDirection: 'row', marginBottom: 4 },
  formWeekday: { width: '14.2857%', textAlign: 'center', color: '#7C8A80', fontSize: 10, fontWeight: '800', paddingVertical: 7 },
  formWeekendText: { color: '#B77942' },
  formCalendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  formDayCell: { width: '14.2857%', height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 10, marginVertical: 1 },
  formWeekendCell: { backgroundColor: '#F8EFE4' },
  formTodayCell: { borderWidth: 1, borderColor: '#6C9875' },
  formDaySelected: { backgroundColor: '#28543B', borderWidth: 0 },
  formDayText: { color: '#20382D', fontSize: 12, fontWeight: '600' },
  formWeekendDayText: { color: '#A46635' },
  formTodayText: { fontWeight: '900' },
  formDaySelectedText: { color: '#FFFFFF' },
  todayMarker: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#28543B', position: 'absolute', bottom: 4 },
  calendarLegend: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 9, marginTop: 7, borderTopWidth: 1, borderTopColor: '#EEF1EC' },
  weekendLegendDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#E7C7A6' },
  todayLegendDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#6C9875', marginLeft: 10 },
  calendarLegendText: { color: '#7C8A80', fontSize: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 21, marginBottom: 10 },
  optionalHint: { color: '#8A968B', fontSize: 11 },
  optionalInline: { color: '#8A968B', fontWeight: '400' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  typeButton: {
    width: '48%', minHeight: 58, flexDirection: 'row', gap: 9, alignItems: 'center',
    paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: '#E0E6DC',
    backgroundColor: '#FFFFFF',
  },
  typeIconWrap: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F4EE',
    alignItems: 'center', justifyContent: 'center',
  },
  selectedButton: { backgroundColor: '#E5F1E5', borderColor: '#287A52' },
  selectedIconWrap: { backgroundColor: '#D2E8D6' },
  typeText: { color: '#45604D', fontSize: 12, fontWeight: '700', flexShrink: 1 },
  selectedText: { color: '#1F6843', fontWeight: '800' },
  row: { flexDirection: 'row', gap: 10 },
  personButton: {
    flex: 1, minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1,
    borderColor: '#E0E6DC', backgroundColor: '#FFFFFF',
  },
  personIconWrap: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1F4EE',
    alignItems: 'center', justifyContent: 'center',
  },
  personText: { color: '#45604D', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  amountWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderColor: '#DDE5DA', borderWidth: 1, borderRadius: 14, paddingHorizontal: 15,
  },
  currency: { fontSize: 26, fontWeight: '700', color: '#287A52', marginRight: 8 },
  amountInput: { flex: 1, paddingVertical: 13, fontSize: 27, fontWeight: '800', color: '#193D2B' },
  inputWithIcon: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#FFFFFF',
    borderColor: '#DDE5DA', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14,
  },
  inputText: { flex: 1, paddingVertical: 13, fontSize: 15, color: '#193D2B' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryButton: {
    minWidth: '30%', maxWidth: '49%', flexGrow: 1, minHeight: 56, flexDirection: 'row',
    alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1, borderColor: '#E0E6DC', backgroundColor: '#FFFFFF',
  },
  selectedCategoryButton: { backgroundColor: '#E5F1E5', borderColor: '#287A52' },
  categoryIconWrap: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: '#F1F4EE',
    alignItems: 'center', justifyContent: 'center',
  },
  categoryText: { color: '#45604D', fontSize: 12, fontWeight: '600', flex: 1, flexShrink: 1 },
  emptyState: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    borderRadius: 12, backgroundColor: '#F0F3ED',
  },
  muted: { color: '#718074', fontSize: 13, lineHeight: 19, flex: 1 },
  noteWrap: { alignItems: 'flex-start', minHeight: 76 },
  noteIcon: { marginTop: 14 },
  noteInput: { minHeight: 70, textAlignVertical: 'top' },
  saveButton: {
    marginTop: 26, minHeight: 54, borderRadius: 15, backgroundColor: '#287A52',
    flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center',
  },
  disabledButton: { opacity: 0.6 },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secureNote: { textAlign: 'center', color: '#718074', fontSize: 11, marginTop: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
