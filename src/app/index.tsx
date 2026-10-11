import { Session } from '@supabase/supabase-js';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;

      if (error) {
        console.error('Session check failed:', error.message);
      }

      setSession(data.session);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleAuth() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      Alert.alert('Missing information', 'Enter your email and password.');
      return;
    }

    if (password.length < 8) {
      Alert.alert(
        'Password too short',
        'Please use a password with at least 8 characters.'
      );
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        if (data.session) {
          Alert.alert('Account created', 'Your account is ready.');
        } else {
          Alert.alert(
            'Check your email',
            'If email confirmation is enabled, confirm your email before signing in.'
          );
          setIsSignUp(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) throw error;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Something went wrong.';

      Alert.alert('Authentication failed', message);
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#294F3A" />
        <Text style={styles.loadingText}>Preparing your finances...</Text>
      </View>
    );
  }

  if (session) {
    return <Redirect href="/dashboard" />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.logo}>
            <Text style={styles.logoEmoji}>🌿</Text>
          </View>

          <Text style={styles.eyebrow}>YOUR FAMILY FINANCES</Text>

          <Text style={styles.title}>
            Money matters.
            {'\n'}
            <Text style={styles.titleAccent}>Together.</Text>
          </Text>

          <Text style={styles.subtitle}>
            Keep track of income, everyday expenses and savings in one simple
            place.
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>EMAIL ADDRESS</Text>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#9AA59B"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />

            <Text style={styles.label}>PASSWORD</Text>

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor="#9AA59B"
              secureTextEntry
              autoCapitalize="none"
              editable={!loading}
            />

            <Pressable
              onPress={handleAuth}
              disabled={loading}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.pressed,
                loading && styles.disabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>
                  {isSignUp ? 'Create account  →' : 'Sign in  →'}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => setIsSignUp(!isSignUp)}
              disabled={loading}
              style={styles.switchButton}
            >
              <Text style={styles.switchText}>
                {isSignUp
                  ? 'Already have an account? Sign in'
                  : "New here? Create your account"}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>
            Your money, your pace, your peace of mind.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F8F4',
  },
  keyboard: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 27,
  },
  logo: {
    width: 62,
    height: 62,
    backgroundColor: '#E6EEE3',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 27,
  },
  logoEmoji: {
    fontSize: 30,
  },
  eyebrow: {
    color: '#728875',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  title: {
    color: '#233B2D',
    fontSize: 39,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 46,
  },
  titleAccent: {
    color: '#628568',
  },
  subtitle: {
    color: '#7D8B80',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 13,
    marginBottom: 32,
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 23,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E9EDE6',
  },
  label: {
    color: '#6D7E70',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 9,
    marginTop: 5,
  },
  input: {
    backgroundColor: '#F7F8F4',
    borderWidth: 1,
    borderColor: '#E7EBE3',
    borderRadius: 13,
    paddingHorizontal: 14,
    height: 49,
    fontSize: 14,
    color: '#253D2F',
    marginBottom: 18,
  },
  submitButton: {
    backgroundColor: '#294F3A',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  switchButton: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 3,
  },
  switchText: {
    color: '#456A4E',
    fontSize: 12,
    fontWeight: '700',
  },
  footer: {
    color: '#96A095',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 28,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#F7F8F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#728875',
    fontSize: 13,
  },
});