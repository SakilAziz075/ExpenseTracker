import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CategoryManager from '../components/CategoryManager';
import TransactionForm from '../components/TransactionForm';
import { initializeHousehold } from '../lib/household';
import { getDashboardSnapshot, isOnlineNow, syncPendingChanges } from '../lib/offlineSync';
import { supabase } from '../lib/supabase';
import { deleteTransaction } from '../lib/transactions';

type TxType = 'income' | 'expense' | 'saving_deposit' | 'saving_withdrawal';
type Tx = {
  id: string; member_id: string; category_id: string | null; type: TxType;
  amount: number | string; occurred_on: string; note: string | null;
  members?: { name?: string } | null; categories?: { name?: string; kind?: string } | null;
};
type Member = { id: string; name: string };
type CategoryTotal = { name: string; amount: number; icon: keyof typeof Ionicons.glyphMap };

const COLORS = { bg: '#F7F8F4', card: '#FFFFFF', green: '#28543B', dark: '#20382D', muted: '#7C8A80', pale: '#E7EFE4', border: '#E8ECE5', cream: '#F1E8D8', red: '#B94C43', purple: '#75617D' };
const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const dateKey = (year: number, month: number, day: number) => {
  // JavaScript normalizes day 0 to the last day of the previous month.
  const date = new Date(year, month, day);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};
const categoryIcon = (name?: string): keyof typeof Ionicons.glyphMap => {
  const value = (name ?? '').toLowerCase();
  if (value.includes('fruit')) return 'nutrition-outline';
  if (value.includes('grocer') || value.includes('food') || value.includes('edible')) return 'cart-outline';
  if (value.includes('electric') || value.includes('utilit')) return 'flash-outline';
  if (value.includes('transport') || value.includes('fuel')) return 'car-outline';
  if (value.includes('medical') || value.includes('health')) return 'medkit-outline';
  if (value.includes('rent') || value.includes('home')) return 'home-outline';
  if (value.includes('education')) return 'school-outline';
  if (value.includes('invest')) return 'trending-up-outline';
  if (value.includes('emergency')) return 'shield-checkmark-outline';
  if (value.includes('saving')) return 'wallet-outline';
  if (value.includes('misc')) return 'ellipsis-horizontal-circle-outline';
  return 'pricetag-outline';
};
const typeLabel = (type: TxType) => ({ income: 'Income', expense: 'Expense', saving_deposit: 'Savings deposit', saving_withdrawal: 'Savings withdrawal' })[type];
const signedAmount = (tx: Tx) => tx.type === 'income' || tx.type === 'saving_withdrawal' ? 1 : -1;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [activeTab, setActiveTab] = useState<'expenses' | 'savings'>('expenses');
  const [expanded, setExpanded] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [categoryManagerVisible, setCategoryManagerVisible] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Tx | null>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState<{ online: boolean; pendingCount: number; lastSyncedAt: string | null }>({ online: true, pendingCount: 0, lastSyncedAt: null });

  const monthStart = dateKey(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = dateKey(month.getFullYear(), month.getMonth() + 1, 0);

  const loadDashboard = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) throw new Error('Please sign in while online before using offline mode.');

      const onlineBeforeLoad = await isOnlineNow();
      if (onlineBeforeLoad) {
        // Creates default members/categories on the first online launch.
        // If connectivity drops mid-request, cached household data is still used below.
        try { await initializeHousehold(); } catch (initializationError) {
          console.warn('Household initialization deferred:', initializationError);
        }
        try { await syncPendingChanges(user.id); } catch (syncError) {
          console.warn('Offline changes remain queued:', syncError);
        }
      }

      const result = await getDashboardSnapshot(user.id);
      const loadedMembers = result.snapshot.members.map((member) => ({ id: member.id, name: member.name }));
      const memberNames = new Map<string, string>(loadedMembers.map((member) => [member.id, member.name]));
      const categoryDetails = new Map<string, { name: string; kind: string }>(
        result.snapshot.categories.map((category) => [category.id, { name: category.name, kind: category.kind }]),
      );
      const enrichedTransactions: Tx[] = result.snapshot.transactions
        .filter((tx) => tx.occurred_on <= monthEnd)
        .map((tx) => ({
          ...tx,
          members: { name: memberNames.get(tx.member_id) ?? 'Household' },
          categories: tx.category_id ? categoryDetails.get(tx.category_id) ?? null : null,
        })) as Tx[];

      setMembers(loadedMembers);
      setTransactions(enrichedTransactions);
      setConnection({ online: result.online, pendingCount: result.pendingCount, lastSyncedAt: result.lastSyncedAt });
      console.log(`Dashboard loaded: ${enrichedTransactions.length} transactions; ${result.pendingCount} pending sync`);
    } catch (error: unknown) {
      console.error('Dashboard loading failed:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred. Check the Expo terminal logs.';
      Alert.alert('Could not load dashboard', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthEnd]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setConnection((current) => ({ ...current, online }));
      if (online) void loadDashboard(false);
    });
    return unsubscribe;
  }, [loadDashboard]);

  const monthTransactions = useMemo(() => transactions.filter(tx => tx.occurred_on >= monthStart && tx.occurred_on <= monthEnd), [transactions, monthStart, monthEnd]);
  const totalsFor = (list: Tx[]) => list.reduce((acc, tx) => {
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'income') acc.income += amount;
    if (tx.type === 'expense') acc.expenses += amount;
    if (tx.type === 'saving_deposit') acc.deposits += amount;
    if (tx.type === 'saving_withdrawal') acc.withdrawals += amount;
    return acc;
  }, { income: 0, expenses: 0, deposits: 0, withdrawals: 0 });
  const allTotals = totalsFor(transactions);
  const monthTotals = totalsFor(monthTransactions);

  // The opening balance is the cumulative available balance before this month.
  const transactionsBeforeMonth = transactions.filter(
    tx => tx.occurred_on < monthStart
  );
  const openingTotals = totalsFor(transactionsBeforeMonth);
  const openingBalance =
    openingTotals.income -
    openingTotals.expenses -
    openingTotals.deposits +
    openingTotals.withdrawals;

  // This month's activity changes the opening balance into the closing balance.
  const monthNetChange =
    monthTotals.income -
    monthTotals.expenses -
    monthTotals.deposits +
    monthTotals.withdrawals;
  const closingBalance = openingBalance + monthNetChange;

  // The main household balance is the closing balance for the selected month.
  const totalSavings = allTotals.deposits - allTotals.withdrawals;
  const selectedDate = dateKey(month.getFullYear(), month.getMonth(), selectedDay);
  const selectedTransactions = monthTransactions.filter(tx => tx.occurred_on === selectedDate);
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const calendarCells: (number | null)[] = [...Array((firstDay + 6) % 7).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (calendarCells.length % 7) calendarCells.push(null);

  const memberSummary = (member: Member) => {
    // The available balance is cumulative through the selected month's end.
    const totals = totalsFor(transactions.filter(tx => tx.member_id === member.id));
    // These figures describe activity in the selected month only.
    const monthly = totalsFor(monthTransactions.filter(tx => tx.member_id === member.id));
    return {
      ...totals,
      available: totals.income - totals.expenses - totals.deposits + totals.withdrawals,
      monthIncome: monthly.income,
      monthExpenses: monthly.expenses,
      monthSavingsNet: monthly.deposits - monthly.withdrawals,
    };
  };
  const categoryTotals: CategoryTotal[] = useMemo(() => {
    const map = new Map<string, number>();
    monthTransactions.filter(tx => activeTab === 'expenses' ? tx.type === 'expense' : tx.type === 'saving_deposit' || tx.type === 'saving_withdrawal').forEach(tx => {
      const name = tx.categories?.name ?? (tx.type === 'saving_withdrawal' ? 'Savings withdrawal' : 'Uncategorized');
      const amount = Number(tx.amount) || 0;
      map.set(name, (map.get(name) ?? 0) + (activeTab === 'expenses' || tx.type === 'saving_deposit' ? amount : -amount));
    });
    return [...map.entries()].map(([name, amount]) => ({ name, amount, icon: categoryIcon(name) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [monthTransactions, activeTab]);
  const categoryTotal = categoryTotals.reduce((sum, item) => sum + item.amount, 0);

  function changeMonth(direction: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + direction, 1);
    setMonth(next);
    setSelectedDay(1);
  }
  function openAdd() {
    setEditingTransaction(null);
    setFormVisible(true);
  }

  function openEdit(tx: Tx) {
    setEditingTransaction(tx);
    setFormVisible(true);
  }

  function confirmDeleteTransaction(tx: Tx) {
    const title =
      tx.type === 'income'
        ? 'Income'
        : tx.categories?.name ?? typeLabel(tx.type);
    const amount = money(Number(tx.amount) || 0);

    Alert.alert(
      'Delete this entry?',
      `Delete "${title}" (${amount})? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteTransaction(tx.id);
                await loadDashboard(false);
              } catch (error: unknown) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Please try again.';
                Alert.alert('Could not delete entry', message);
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadDashboard(false); }} tintColor={COLORS.green} />}>
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>YOUR FAMILY FINANCES</Text><Text style={styles.title}>Money Matters.</Text><Text style={styles.subtitle}>A little clarity, every day.</Text></View>
          <View style={styles.headerIcon}><Ionicons name="wallet-outline" size={26} color={COLORS.green} /></View>
        </View>

        {(!connection.online || connection.pendingCount > 0) && (
          <View style={[styles.syncBanner, !connection.online && styles.syncBannerOffline]}>
            <Ionicons name={!connection.online ? 'cloud-offline-outline' : 'cloud-upload-outline'} size={17} color={!connection.online ? '#98652F' : COLORS.green} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.syncTitle, !connection.online && styles.syncTitleOffline]}>
                {!connection.online ? 'Offline mode' : 'Waiting to sync'}
              </Text>
              <Text style={styles.syncCaption}>
                {!connection.online
                  ? 'Changes are saved on this phone and will sync when internet returns.'
                  : `${connection.pendingCount} change${connection.pendingCount === 1 ? '' : 's'} waiting to sync.`}
              </Text>
            </View>
            {connection.pendingCount > 0 && <Text style={styles.pendingBadge}>{connection.pendingCount}</Text>}
          </View>
        )}

        <View style={styles.monthSelector}>
          <Pressable onPress={() => changeMonth(-1)} style={styles.monthArrow}><Ionicons name="chevron-back" size={20} color={COLORS.dark} /></Pressable>
          <View style={{ alignItems: 'center' }}><Text style={styles.monthLabel}>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text><Text style={styles.monthHint}>MONTHLY OVERVIEW</Text></View>
          <Pressable onPress={() => changeMonth(1)} style={styles.monthArrow}><Ionicons name="chevron-forward" size={20} color={COLORS.dark} /></Pressable>
        </View>

        <Pressable onPress={() => setExpanded(v => !v)} style={styles.balanceCard}>
          <View style={styles.balanceTop}><View style={{ flex: 1 }}><Text style={styles.balanceLabel}>AVAILABLE TO SPEND · MONTH END</Text><Text style={styles.totalAmount}>{loading ? '—' : money(closingBalance)}</Text><Text style={styles.balanceCaption}>Accumulated balance after this month's activity</Text></View><View style={styles.balanceIcon}><Ionicons name="wallet" size={27} color="#E3F0E3" /></View></View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceBottom}><View style={styles.avatarPair}><View style={styles.smallAvatar}><Ionicons name="person-outline" size={15} color={COLORS.green} /></View><View style={[styles.smallAvatar, styles.momAvatar]}><Ionicons name="person" size={15} color={COLORS.purple} /></View></View><Text style={styles.expandLabel}>{expanded ? 'Hide individual balances' : 'View individual balances'}</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color="#E3F0E3" /></View>
        </Pressable>

        {expanded && <View style={styles.breakdownCard}>{members.map((member, index) => { const totals = memberSummary(member); return <View key={member.id} style={[styles.memberRow, index < members.length - 1 && styles.memberBorder]}><View style={styles.memberIcon}><Ionicons name="person-outline" size={18} color={index === 0 ? COLORS.green : COLORS.purple} /></View><View style={{ flex: 1 }}><Text style={styles.memberName}>{member.name}</Text><Text style={styles.memberCaption}>This month · Income {money(totals.monthIncome)} · Spent {money(totals.monthExpenses)}</Text><Text style={styles.memberCaption}>Savings net {money(totals.monthSavingsNet)}</Text></View><Text style={styles.memberBalance}>{money(totals.available)}</Text></View>; })}<Text style={styles.breakdownNote}>Right-side amounts are accumulated available balances through this month end. Net change = income − expenses − deposits + withdrawals.</Text></View>}

        <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>Your calendar</Text><Text style={styles.sectionSubtitle}>Select a day to view entries</Text></View><View style={styles.monthPill}><Text style={styles.monthPillText}>{monthTransactions.length} ENTRIES</Text></View></View>
        <View style={styles.calendarCard}>
          <View style={styles.weekdays}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={[styles.weekday, index >= 5 && styles.weekendWeekday]}>{day}</Text>)}</View>
          <View style={styles.calendarGrid}>{calendarCells.map((day, index) => {
            if (!day) return <View key={`empty-${index}`} style={styles.dayCell} />;
            const key = dateKey(month.getFullYear(), month.getMonth(), day);
            const dayTx = monthTransactions.filter(tx => tx.occurred_on === key);
            const selected = day === selectedDay;
            const weekday = new Date(month.getFullYear(), month.getMonth(), day).getDay();
            const isWeekend = weekday === 0 || weekday === 6;
            const daySpend = dayTx.some(tx => tx.type === 'expense' || tx.type === 'saving_deposit' || tx.type === 'saving_withdrawal');
            return <Pressable key={key} onPress={() => setSelectedDay(day)} style={[styles.dayCell, isWeekend && styles.weekendDayCell, selected && styles.daySelected]}><Text style={[styles.dayText, isWeekend && styles.weekendDayText, selected && styles.dayTextSelected]}>{day}</Text>{dayTx.length > 0 && <View style={[styles.dayDot, selected && styles.dayDotSelected, daySpend && !selected && styles.dayDotSpend]} />}</Pressable>;
          })}</View>
          <View style={styles.calendarLegend}><View style={styles.legendDot} /><Text style={styles.legendText}>Has transactions</Text><Text style={styles.selectedDate}>{month.toLocaleDateString('en-IN', { month: 'short' })} {selectedDay}</Text></View>
        </View>

        <View style={styles.monthStats}><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#E5F0E4' }]}><Ionicons name="arrow-down-outline" size={18} color={COLORS.green} /></View><Text style={styles.statLabel}>INCOME THIS MONTH</Text><Text style={styles.statAmount}>{money(monthTotals.income)}</Text></View><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#F7E9E4' }]}><Ionicons name="arrow-up-outline" size={18} color={COLORS.red} /></View><Text style={styles.statLabel}>SPENT THIS MONTH</Text><Text style={styles.statAmount}>{money(monthTotals.expenses)}</Text></View></View>
        <View style={styles.monthStats}><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#E9E6F0' }]}><Ionicons name="trending-up-outline" size={18} color={COLORS.purple} /></View><Text style={styles.statLabel}>SAVINGS · MONTH END</Text><Text style={styles.statAmount}>{money(totalSavings)}</Text></View><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#F4EDDF' }]}><Ionicons name="calendar-outline" size={18} color="#96733F" /></View><Text style={styles.statLabel}>MONTH'S NET CHANGE</Text><Text style={styles.statAmount}>{money(monthNetChange)}</Text></View></View>
        <View style={styles.monthStats}><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#F4EDDF' }]}><Ionicons name="arrow-back-circle-outline" size={18} color="#96733F" /></View><Text style={styles.statLabel}>OPENING BALANCE</Text><Text style={styles.statAmount}>{money(openingBalance)}</Text></View><View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: '#E5F0E4' }]}><Ionicons name="arrow-forward-circle-outline" size={18} color={COLORS.green} /></View><Text style={styles.statLabel}>CLOSING BALANCE</Text><Text style={styles.statAmount}>{money(closingBalance)}</Text></View></View>

        <View style={styles.tabs}><Pressable onPress={() => setActiveTab('expenses')} style={[styles.tab, activeTab === 'expenses' && styles.tabActive]}><Ionicons name="receipt-outline" size={17} color={activeTab === 'expenses' ? '#FFFFFF' : COLORS.green} /><Text style={[styles.tabText, activeTab === 'expenses' && styles.tabTextActive]}>Expenses</Text></Pressable><Pressable onPress={() => setActiveTab('savings')} style={[styles.tab, activeTab === 'savings' && styles.tabActive]}><Ionicons name="save-outline" size={17} color={activeTab === 'savings' ? '#FFFFFF' : COLORS.green} /><Text style={[styles.tabText, activeTab === 'savings' && styles.tabTextActive]}>Savings</Text></Pressable></View>
        <View style={styles.categoryCard}><View style={styles.categoryHeader}><View style={{ flex: 1 }}><Text style={styles.categoryHeading}>{activeTab === 'expenses' ? 'Expense categories' : 'Savings activity'}</Text><Text style={styles.categorySubheading}>{month.toLocaleDateString('en-IN', { month: 'long' })} breakdown</Text><Pressable style={styles.manageCategoriesButton} onPress={() => setCategoryManagerVisible(true)}><Ionicons name="options-outline" size={14} color={COLORS.green} /><Text style={styles.manageCategoriesText}>Manage categories</Text></Pressable></View><Text style={styles.categoryTotal}>{money(categoryTotal)}</Text></View>
          {categoryTotals.length === 0 ? <View style={styles.emptyCategory}><Ionicons name="bar-chart-outline" size={25} color={COLORS.muted} /><Text style={styles.emptyText}>No {activeTab === 'expenses' ? 'expenses' : 'savings activity'} recorded this month.</Text></View> : categoryTotals.map(item => <View key={item.name} style={styles.categoryRow}><View style={styles.categoryIdentity}><View style={styles.categoryIcon}><Ionicons name={item.icon} size={19} color={COLORS.green} /></View><Text style={styles.categoryName}>{item.name}</Text></View><Text style={styles.categoryAmount}>{money(item.amount)}</Text></View>)}
          <Pressable style={styles.outlineButton} onPress={openAdd}><Ionicons name="add" size={18} color={COLORS.green} /><Text style={styles.outlineButtonText}>Add {activeTab === 'expenses' ? 'expense' : 'savings entry'}</Text></Pressable>
        </View>

        <View style={styles.entriesHeading}><View><Text style={styles.sectionTitle}>Daily entries</Text><Text style={styles.sectionSubtitle}>{month.toLocaleDateString('en-IN', { month: 'short' })} {selectedDay}</Text></View><Text style={styles.entriesCount}>{selectedTransactions.length} entries</Text></View>
        <View style={styles.entriesCard}>{selectedTransactions.length === 0 ? <View style={styles.emptyEntries}><Ionicons name="document-text-outline" size={26} color={COLORS.muted} /><Text style={styles.emptyText}>Nothing recorded for this day.</Text><Pressable onPress={openAdd}><Text style={styles.addFirstText}>Add an entry</Text></Pressable></View> : selectedTransactions.map(tx => { const isPositive = signedAmount(tx) > 0; const title = tx.type === 'income' ? 'Income' : tx.categories?.name ?? typeLabel(tx.type); return <View key={tx.id} style={styles.entryRow}><View style={[styles.entryIcon, { backgroundColor: isPositive ? '#E5F0E4' : '#F7E9E4' }]}><Ionicons name={tx.type === 'income' ? 'cash-outline' : tx.type === 'expense' ? categoryIcon(title) : 'wallet-outline'} size={19} color={isPositive ? COLORS.green : COLORS.red} /></View><View style={{ flex: 1 }}><Text style={styles.entryTitle}>{title}</Text><Text style={styles.entryMeta}>{tx.members?.name ?? 'Household'}{tx.note ? ` · ${tx.note}` : ''}</Text></View><Text style={[styles.entryAmount, { color: isPositive ? COLORS.green : COLORS.dark }]}>{isPositive ? '+' : '−'}{money(Number(tx.amount) || 0)}</Text><Pressable onPress={() => openEdit(tx)} style={styles.editButton} accessibilityRole="button" accessibilityLabel={`Edit ${title}`} hitSlop={8}><Ionicons name="create-outline" size={18} color={COLORS.green} /></Pressable><Pressable onPress={() => confirmDeleteTransaction(tx)} style={styles.deleteButton} accessibilityRole="button" accessibilityLabel={`Delete ${title}`} hitSlop={8}><Ionicons name="trash-outline" size={18} color={COLORS.red} /></Pressable></View>; })}</View>
        <Text style={styles.footer}>Every entry counts. Keep your finances clear.</Text>
      </ScrollView>
      <Pressable
        style={[styles.fab, { bottom: Math.max(insets.bottom, 8) + 16 }]}
        onPress={openAdd}
        accessibilityLabel="Add transaction"
      ><Ionicons name="add" size={23} color="#FFFFFF" /><Text style={styles.fabText}>Add entry</Text></Pressable>
      <CategoryManager
        visible={categoryManagerVisible}
        onClose={() => setCategoryManagerVisible(false)}
        onChanged={() => { void loadDashboard(false); }}
      />
      <TransactionForm
        visible={formVisible}
        transaction={editingTransaction}
        onClose={() => {
          setFormVisible(false);
          setEditingTransaction(null);
        }}
        onSaved={() => {
          setFormVisible(false);
          setEditingTransaction(null);
          void loadDashboard(false);
        }}
      />
      {loading && <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={COLORS.green} /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg }, content: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 }, eyebrow: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, marginBottom: 6 }, title: { color: COLORS.dark, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }, subtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4 }, headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' },
  monthSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17 }, monthArrow: { width: 38, height: 38, borderRadius: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' }, monthLabel: { color: COLORS.dark, fontSize: 17, fontWeight: '800' }, monthHint: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginTop: 4 },
  balanceCard: { backgroundColor: COLORS.green, borderRadius: 23, padding: 20, marginBottom: 15 }, balanceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, balanceLabel: { color: '#C9DCCB', fontSize: 9, fontWeight: '800', letterSpacing: 1.3 }, totalAmount: { color: '#FFFFFF', fontSize: 33, fontWeight: '800', marginTop: 7, letterSpacing: -0.7 }, balanceCaption: { color: '#D5E3D5', fontSize: 12, marginTop: 3 }, balanceIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: '#FFFFFF20', alignItems: 'center', justifyContent: 'center' }, balanceDivider: { height: 1, backgroundColor: '#FFFFFF30', marginVertical: 17 }, balanceBottom: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatarPair: { flexDirection: 'row', width: 47 }, smallAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E5F0E4', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.green }, momAvatar: { marginLeft: -8, backgroundColor: '#E9E3EE' }, expandLabel: { flex: 1, color: '#F0F5EE', fontSize: 12, fontWeight: '700' },
  breakdownCard: { backgroundColor: COLORS.card, borderRadius: 18, paddingHorizontal: 15, paddingTop: 4, paddingBottom: 13, marginBottom: 19, borderWidth: 1, borderColor: COLORS.border }, memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10 }, memberBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border }, memberIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' }, memberName: { color: COLORS.dark, fontSize: 13, fontWeight: '800' }, memberCaption: { color: COLORS.muted, fontSize: 11, marginTop: 3 }, memberBalance: { color: COLORS.green, fontSize: 14, fontWeight: '800' }, breakdownNote: { color: COLORS.muted, fontSize: 10, marginTop: 8 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 6 }, sectionTitle: { color: COLORS.dark, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }, sectionSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, monthPill: { backgroundColor: COLORS.pale, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 }, monthPillText: { color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  calendarCard: { backgroundColor: COLORS.card, borderRadius: 20, paddingHorizontal: 13, paddingTop: 15, paddingBottom: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 18 }, weekdays: { flexDirection: 'row', marginBottom: 7 }, weekday: { flex: 1, textAlign: 'center', color: COLORS.muted, fontSize: 10, fontWeight: '800', paddingVertical: 5 }, weekendWeekday: { color: '#B77942' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, dayCell: { width: `${100 / 7}%`, height: 41, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginVertical: 1 }, weekendDayCell: { backgroundColor: '#F8EFE4' }, weekendDayText: { color: '#A46635' }, daySelected: { backgroundColor: COLORS.green }, dayText: { color: COLORS.dark, fontSize: 12, fontWeight: '600' }, dayTextSelected: { color: '#FFFFFF', fontWeight: '800' }, dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#79A67A', marginTop: 2 }, dayDotSelected: { backgroundColor: '#FFFFFF' }, dayDotSpend: { backgroundColor: '#D6A26C' }, calendarLegend: { flexDirection: 'row', alignItems: 'center', marginTop: 11, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 11 }, legendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#79A67A', marginRight: 6 }, legendText: { color: COLORS.muted, fontSize: 10, flex: 1 }, selectedDate: { color: COLORS.dark, fontSize: 11, fontWeight: '800' },
  monthStats: { flexDirection: 'row', gap: 11, marginBottom: 11 }, statCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 17, padding: 13, borderWidth: 1, borderColor: COLORS.border }, statIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 11 }, statLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 }, statAmount: { color: COLORS.dark, fontSize: 16, fontWeight: '800', marginTop: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#E9EDE6', borderRadius: 13, padding: 4, marginTop: 13, marginBottom: 12 }, tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 10 }, tabActive: { backgroundColor: COLORS.green }, tabText: { color: COLORS.green, fontSize: 12, fontWeight: '800' }, tabTextActive: { color: '#FFFFFF' }, categoryCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 }, categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 }, categoryHeading: { color: COLORS.dark, fontSize: 15, fontWeight: '800' }, categorySubheading: { color: COLORS.muted, fontSize: 11, marginTop: 4 }, manageCategoriesButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 8, paddingVertical: 5, paddingHorizontal: 8, backgroundColor: COLORS.pale, borderRadius: 8 }, manageCategoriesText: { color: COLORS.green, fontSize: 10, fontWeight: '800' }, categoryTotal: { color: COLORS.green, fontSize: 16, fontWeight: '800' }, categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#F0F2EE' }, categoryIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }, categoryIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' }, categoryName: { color: COLORS.dark, fontSize: 12, fontWeight: '700' }, categoryAmount: { color: COLORS.dark, fontSize: 13, fontWeight: '800' }, emptyCategory: { alignItems: 'center', paddingVertical: 22, gap: 8 }, emptyText: { color: COLORS.muted, fontSize: 12, textAlign: 'center' }, outlineButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#CBDAC9', borderRadius: 12, paddingVertical: 11, marginTop: 10 }, outlineButtonText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  entriesHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }, entriesCount: { color: COLORS.muted, fontSize: 11, fontWeight: '700' }, entriesCard: { backgroundColor: COLORS.card, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 20 }, emptyEntries: { alignItems: 'center', paddingVertical: 25, gap: 9 }, addFirstText: { color: COLORS.green, fontSize: 12, fontWeight: '800', marginTop: 2 }, entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F0F2EE' }, entryIcon: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, entryTitle: { color: COLORS.dark, fontSize: 12, fontWeight: '800' }, entryMeta: { color: COLORS.muted, fontSize: 10, marginTop: 4 }, entryAmount: { fontSize: 12, fontWeight: '800' }, editButton: { width: 32, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.pale, marginLeft: 2 }, deleteButton: { width: 32, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBEDEA', marginLeft: 2 }, footer: { color: COLORS.muted, textAlign: 'center', fontSize: 10, marginTop: 3, marginBottom: 14 }, fab: { position: 'absolute', bottom: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.green, paddingVertical: 14, paddingHorizontal: 19, borderRadius: 17, elevation: 5, shadowColor: '#1D3828', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, fabText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E7EFE4', borderRadius: 13, padding: 12, marginTop: -10, marginBottom: 16, borderWidth: 1, borderColor: '#D5E4D2' }, syncBannerOffline: { backgroundColor: '#F8EFE4', borderColor: '#E9D8C1' }, syncTitle: { color: COLORS.green, fontSize: 12, fontWeight: '800' }, syncTitleOffline: { color: '#98652F' }, syncCaption: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 2 }, pendingBadge: { minWidth: 24, textAlign: 'center', overflow: 'hidden', borderRadius: 8, backgroundColor: '#FFFFFF', color: COLORS.green, paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, fontWeight: '800' }, loadingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#F7F8F4A8', alignItems: 'center', justifyContent: 'center' },
});
