import { PermissionsAndroid, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export interface InboxSms {
  id: string;
  /** Sender — an alphanumeric header like "VM-HDFCBK" for banks, a phone number for people. */
  address: string;
  body: string;
  /** Received time, epoch millis. */
  date: number;
}

interface SmsReaderNative {
  readInbox(sinceMs: number, limit: number): Promise<InboxSms[]>;
}

// Null on iOS, web, Expo Go, and dev clients built before this module was added, so every caller
// must check `isSmsReaderAvailable`.
const native = Platform.OS === "android" ? requireOptionalNativeModule<SmsReaderNative>("SmsReader") : null;

export function isSmsReaderAvailable() {
  return native !== null;
}

export async function hasSmsPermission() {
  if (!native) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

export async function requestSmsPermission() {
  if (!native) return false;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: "Read bank SMS",
    message: "Family Finance reads bank and card alerts on this phone to record transactions for you. Messages never leave the device — only the parsed amount, payee and date are saved.",
    buttonPositive: "Allow",
    buttonNegative: "Not now",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function readInbox(sinceMs: number, limit = 500): Promise<InboxSms[]> {
  if (!native) throw new Error("SMS reading isn't available on this device");
  return native.readInbox(sinceMs, limit);
}
