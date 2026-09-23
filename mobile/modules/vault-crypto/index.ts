import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

interface VaultCryptoNative {
  pbkdf2Sha256(passwordB64: string, saltB64: string, iterations: number, keyLength: number): Promise<string>;
}

// Null on iOS, web, Expo Go, and dev clients built before this module existed — callers fall back
// to a (much slower) pure-JS implementation.
const native = Platform.OS === "android" ? requireOptionalNativeModule<VaultCryptoNative>("VaultCrypto") : null;

export function nativePbkdf2Available() {
  return native !== null;
}

export function nativePbkdf2Sha256(passwordB64: string, saltB64: string, iterations: number, keyLength: number) {
  if (!native) throw new Error("Native PBKDF2 is not available");
  return native.pbkdf2Sha256(passwordB64, saltB64, iterations, keyLength);
}
