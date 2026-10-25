# Shared web kit

Everything under `src/shared/` is used by all three pages built from this folder: the **field app** (`/`, `src/field`), the **QR public form** (`/q/`, `src/qr`) and the **admin console** (`/admin/`, `src/admin`).

| File | What it gives you |
|---|---|
| `types.ts` | The API contract (mirrors the server's Pydantic models; see `portal/docs/API.md`). Import types from here only. |
| `api.ts` | `createApi(tokenKey)` → `get/post/put/del/putBytes/download/file`, `ApiError`, `errorKey(e)`, `isNative`, `serverBase()`. All paths are relative to `/api/v1`. |
| `base.css` + `tokens.css` | Design tokens (copied from `/design/tokens.css` by `scripts/sync-tokens.mjs`) and every component class. Import `base.css` once per page. |
| `i18n/` | `I18nProvider`, `useI18n()` → `{ t, lang, setLang, pick }`. Packs are flat JSON; the kit's strings are `shared.<lang>.json`; add your app's keys in `field.<lang>.json` / `admin.<lang>.json` / `qr.<lang>.json` and pass them as `packs`. `pick(obj)` reads `{en,hi,ta,kn}` objects from the server. |
| `ui/index.tsx` | Components: `Button LinkButton BackButton Chip ChipBar Pill BandPill Card CardHead Sheet Confirm ToastProvider/useToast (show, error, success, undoable) Skeleton ListSkeleton EmptyState SearchEmpty ErrorCard ErrorBoundary Field Input Textarea Select Toggle Segmented Form Tabs Progress Banner RiskMatrix Thumb Lightbox Timeline KpiTile Bars DataTable Pagination ShortcutsHelp useShortcutsHelp SuccessMark I18nText`. |
| `hooks.ts` | `useOnline(probe) useDebounced useLocalState useMediaQuery useInterval useTick useLoad useGeo useHotkeys useBeforeUnload`. |
| `format.ts` | IST dates (`fmtDate fmtDateTime fmtTime relative dueText`), numbers, `BAND_COLOUR`, `initials`, `addWorkingDays`, `csvEscape`. |
| `risk.ts` | `bandFor(matrix, l, s)`, `cellColour`, `DEFAULT_MATRIX`, `DEFAULT_DUE_RULES`, `ruleFor`, `dueFromRule`, `is3786Default`. Same arithmetic as the server. |
| `image.ts` | `preparePhoto(file, {purpose, blur, lat, lng})` → compressed JPEG (1,600 px, EXIF gone), SHA-256 and a ready `MediaRef`; `applyBlur`, `signatureFromCanvas`, `voiceNote`. |
| `storage.ts` | Safe localStorage (`safeGet safeSet getJSON setJSON`), `uuid()`, `deviceId()`, `sha256Hex`, `copyText`. |
| `icons.tsx` | Line icons, `size` prop. |

Rules for every page:
- Wrap the tree in `I18nProvider` → `ToastProvider` → `ErrorBoundary`.
- One primary (`variant="primary"`, hi-vis) action per screen. Red is for prohibited/critical/overdue only.
- Lists: skeleton while loading, `EmptyState`/`SearchEmpty` when empty, `ErrorCard` with retry on failure.
- Destructive or hard-to-redo actions go through `toast.undoable()` (soft delete) or `Confirm` with a reason.
- Keyboard: `useHotkeys` for shortcuts, `useShortcutsHelp` to render the `?` sheet.
- Never hard-code English: `t("key")` and `pick(serverI18nObject)`.
