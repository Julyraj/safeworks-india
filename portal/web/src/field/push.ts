/* Web Push (VAPID) on this phone: subscribe through the service worker and register the subscription with the server
   (`POST /me/devices`), so critical alerts and reminders arrive when the app is closed. The server's public key comes
   with `Me.pushPublicKey` (null when the server has no VAPID keys). The Android app (Capacitor) has no Web Push; it
   needs Firebase, which is an owner decision (HANDOVER.md §5), so the switch is hidden there. */
import { api, APP_VERSION } from "./api";
import { isNative } from "../shared/api";
import { deviceId } from "../shared/storage";

export type PushState = "unsupported" | "unconfigured" | "denied" | "on" | "off";

export function pushSupported(): boolean {
  return !isNative && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(publicKey: string | null | undefined): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!publicKey) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? "on" : "off";
}

/** Asks for permission, subscribes and tells the server. Resolves to the new state. */
export async function enablePush(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await api.post("/me/devices", { deviceUuid: deviceId(), platform: "web", appVersion: APP_VERSION, subscription: sub.toJSON() });
  return "on";
}

/** Unsubscribes this phone and clears the subscription on the server. */
export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) await sub.unsubscribe();
  await api.post("/me/devices", { deviceUuid: deviceId(), platform: "web", appVersion: APP_VERSION, subscription: null });
  return "off";
}
