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
  readInboxBefore(beforeMs: number, limit: number): Promise<InboxSms[]>;
}

// Null on iOS, web, Expo Go, and dev clients built before this module was added, so every caller
// must check `isSmsReaderAvailable`.
const native = Platform.OS === "android" ? requireOptionalNativeModule<SmsReaderNative>("SmsReader") : null;

export function isSmsReaderAvailable() {
  return native !== null;
}

export async function hasSmsPermission() {
  if (!native) return false;
  // READ_SMS lets us scan the inbox; RECEIVE_SMS is what lets the OS deliver the SMS_RECEIVED
  // broadcast to this app at all, which SmsReceivedReceiver needs to wake a scan the instant a
  // message arrives. Both are separate dangerous permissions even though they're offered together.
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
  if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  // Same permission group, so this shows no extra dialog on most OEMs — but request it explicitly
  // since Android tracks it separately, and it's what lets SmsReceivedReceiver see new messages.
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).catch(() => undefined);
  return true;
}

/**
 * RECEIVE_SMS is what lets the SMS wake-up run while the app is closed. Builds before that existed
 * only asked for READ_SMS, so a phone that turned import on back then never got it: ask once more.
 * The two share a permission group, so this is normally granted without a dialog.
 */
export async function ensureReceiveSmsPermission() {
  if (!native) return false;
  if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) return true;
  if (!(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS))) return false;
  return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** Messages received after `sinceMs`, oldest first. */
export async function readInbox(sinceMs: number, limit = 500): Promise<InboxSms[]> {
  if (!native) throw new Error("SMS reading isn't available on this device");
  return native.readInbox(sinceMs, limit);
}

/** Messages received before `beforeMs`, newest first. */
export async function readInboxBefore(beforeMs: number, limit = 500): Promise<InboxSms[]> {
  if (!native) throw new Error("SMS reading isn't available on this device");
  return native.readInboxBefore(beforeMs, limit);
}
