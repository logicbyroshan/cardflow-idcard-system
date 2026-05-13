import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Crash:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={s.container}>
          <Text style={s.title}>Something went wrong</Text>
          <Text style={s.message}>{this.state.error?.toString()}</Text>
          <TouchableOpacity 
            style={s.btn} 
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={s.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', color: '#ef4444', marginBottom: 10 },
  message: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 20 },
  btn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#667eea', borderRadius: 8 },
  btnText: { color: '#fff', fontFamily: 'SairaSemiCondensed-Bold' },
});
