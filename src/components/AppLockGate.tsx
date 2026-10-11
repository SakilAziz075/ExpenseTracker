import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    AppStateStatus,
    Keyboard,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { supabase } from '../lib/supabase';

type LockMode = 'none' | 'loading' | 'setup' | 'confirm' | 'locked' | 'unlocked';

const PIN_KEY_PREFIX = 'expense_tracker_app_pin_';
const GREEN = '#28543B';
const DARK = '#20382D';
const MUTED = '#7C8A80';
const BG = '#F7F8F4';
const BORDER = '#E8ECE5';

export default function AppLockGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LockMode>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [savedPin, setSavedPin] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const activeUserRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let mounted = true;

    const applySession = async (session: Session | null) => {
      const nextUserId = session?.user.id ?? null;

      if (!nextUserId) {
        activeUserRef.current = null;
        if (mounted) {
          setUserId(null);
          setSavedPin(null);
          setPin('');
          setFirstPin('');
          setMessage('');
          setMode('none');
        }
        return;
      }

      // Avoid locking again on routine token refresh events for the same user.
      if (activeUserRef.current === nextUserId) return;
      activeUserRef.current = nextUserId;

      if (mounted) {
        setUserId(nextUserId);
        setSavedPin(null);
        setPin('');
        setFirstPin('');
        setMessage('');
        setMode('loading');
      }

      try {
        const existingPin = await SecureStore.getItemAsync(
          `${PIN_KEY_PREFIX}${nextUserId}`
        );
        if (!mounted || activeUserRef.current !== nextUserId) return;
        setSavedPin(existingPin);
        setMode(existingPin ? 'locked' : 'setup');
      } catch (error) {
        console.error('Could not read the app PIN:', error);
        if (mounted && activeUserRef.current === nextUserId) {
          setMessage('Could not access secure storage. Please restart the app and try again.');
          setMode('setup');
        }
      }
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.warn('Could not read the current session:', error.message);
      if (mounted) void applySession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;

      if (wasActive && nextState !== 'active' && savedPin && userId) {
        setPin('');
        setMessage('');
        setMode((current) => current === 'unlocked' ? 'locked' : current);
      }
    });

    return () => subscription.remove();
  }, [savedPin, userId]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setTimeout(() => {
      setCooldownUntil(0);
      setAttempts(0);
      setMessage('');
    }, cooldownUntil - Date.now());
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  function updatePin(value: string) {
    setPin(value.replace(/\D/g, '').slice(0, 6));
    if (message) setMessage('');
  }

  async function submitPin() {
    Keyboard.dismiss();
    if (!userId || busy) return;

    if (mode === 'setup') {
      if (pin.length < 4) {
        setMessage('Choose a PIN containing 4 to 6 digits.');
        return;
      }
      setFirstPin(pin);
      setPin('');
      setMessage('');
      setMode('confirm');
      return;
    }

    if (mode === 'confirm') {
      if (pin !== firstPin) {
        setFirstPin('');
        setPin('');
        setMessage('The PINs did not match. Please create your PIN again.');
        setMode('setup');
        return;
      }

      setBusy(true);
      try {
        await SecureStore.setItemAsync(`${PIN_KEY_PREFIX}${userId}`, pin);
        setSavedPin(pin);
        setFirstPin('');
        setPin('');
        setMessage('');
        setMode('unlocked');
      } catch (error) {
        console.error('Could not save the app PIN:', error);
        setMessage('Could not save your PIN securely. Please try again.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === 'locked') {
      if (Date.now() < cooldownUntil) {
        setMessage('Too many incorrect attempts. Please wait before trying again.');
        return;
      }
      if (pin.length < 4) {
        setMessage('Enter your 4 to 6 digit PIN.');
        return;
      }
      if (pin === savedPin) {
        setAttempts(0);
        setPin('');
        setMessage('');
        setMode('unlocked');
        return;
      }

      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setPin('');
      if (nextAttempts >= 5) {
        setCooldownUntil(Date.now() + 30_000);
        setMessage('Too many incorrect attempts. Try again in 30 seconds.');
      } else {
        setMessage(`Incorrect PIN. ${5 - nextAttempts} attempt${5 - nextAttempts === 1 ? '' : 's'} remaining.`);
      }
    }
  }

  if (mode === 'none' || mode === 'unlocked') {
    return <>{children}</>;
  }

  const isSetup = mode === 'setup' || mode === 'confirm';
  const title = mode === 'loading'
    ? 'Preparing app lock'
    : mode === 'confirm'
      ? 'Confirm your PIN'
      : mode === 'setup'
        ? 'Create your app PIN'
        : 'Welcome back';
  const subtitle = mode === 'loading'
    ? 'Checking your device security...'
    : mode === 'confirm'
      ? 'Enter the same 4–6 digit PIN once more.'
      : mode === 'setup'
        ? 'Choose a 4–6 digit PIN to protect your family finances.'
        : 'Enter your PIN to unlock your family finances.';

  return (
    <View style={styles.overlay}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      {mode === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={styles.loadingText}>{title}</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.logo}>
            <Ionicons name="lock-closed-outline" size={29} color={GREEN} />
          </View>
          <Text style={styles.eyebrow}>MONEY MATTERS</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.pinCard}>
            <Text style={styles.label}>{isSetup ? 'NEW PIN' : 'APP PIN'}</Text>
            <TextInput
              value={pin}
              onChangeText={updatePin}
              style={styles.pinInput}
              placeholder="••••"
              placeholderTextColor="#AAB4AA"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              autoFocus
              editable={!busy && Date.now() >= cooldownUntil}
              onSubmitEditing={() => void submitPin()}
              returnKeyType="done"
              accessibilityLabel={isSetup ? 'Create app PIN' : 'Enter app PIN'}
            />
            <Text style={styles.pinHint}>4–6 digits</Text>
            {!!message && <Text style={styles.error}>{message}</Text>}
            {cooldownUntil > Date.now() && mode === 'locked' ? (
              <View style={[styles.button, styles.buttonDisabled]}>
                <Text style={styles.buttonText}>Please wait 30 seconds</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void submitPin()}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === 'setup' ? 'Continue' : mode === 'confirm' ? 'Save PIN' : 'Unlock'}
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          <View style={styles.privacyNote}>
            <Ionicons name="shield-checkmark-outline" size={17} color={GREEN} />
            <Text style={styles.privacyText}>
              Your PIN is stored securely on this device and works without internet.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: BG,
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  loading: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: MUTED, fontSize: 13, marginTop: 13 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  logo: {
    width: 62, height: 62, borderRadius: 21, backgroundColor: '#E6EEE3',
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  eyebrow: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, marginBottom: 10 },
  title: { color: DARK, fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 9, marginBottom: 24 },
  pinCard: { backgroundColor: '#FFFFFF', borderRadius: 21, padding: 19, borderWidth: 1, borderColor: BORDER },
  label: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 9 },
  pinInput: {
    height: 58, borderWidth: 1, borderColor: BORDER, borderRadius: 13,
    backgroundColor: BG, color: DARK, textAlign: 'center', fontSize: 25,
    fontWeight: '800', letterSpacing: 12, paddingLeft: 12,
  },
  pinHint: { color: MUTED, fontSize: 10, textAlign: 'center', marginTop: 8 },
  error: { color: '#B94C43', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  button: {
    height: 51, borderRadius: 13, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center', marginTop: 17,
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  privacyNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22 },
  privacyText: { color: MUTED, fontSize: 10, lineHeight: 16, flex: 1 },
});
