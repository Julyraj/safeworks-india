import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base(size = 22, rest: SVGProps<SVGSVGElement>) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const IconHome = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></svg>
);
export const IconList = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={3} /></svg>
);
export const IconPlus = ({ size, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.6}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCamera = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.4}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const IconBell = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
);
export const IconMore = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const IconPhone = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M5 4h4l1.5 4.5L8 10a11 11 0 0 0 6 6l1.5-2.5L20 15v4a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4" /></svg>
);
export const IconBook = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></svg>
);
export const IconUser = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const IconLogout = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></svg>
);
export const IconChart = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M4 20V4M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></svg>
);
export const IconX = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconBack = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconSearch = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
);
export const IconAlert = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.5h.01" /></svg>
);
export const IconWalk = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="13" cy="4.5" r="2" /><path d="m9 21 3-6 3 3v3M7 12l3-4 4 1 2 4 3 1" /></svg>
);
export const IconApprove = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M9 11.5 11.5 14 16 9" /><path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" /></svg>
);
export const IconDownload = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>
);
export const IconUsers = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></svg>
);
export const IconSettings = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1" /></svg>
);
export const IconSite = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></svg>
);
export const IconClock = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconLog = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h7M9 16h7" /></svg>
);
export const IconLock = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><rect x="5" y="10.5" width="14" height="10" rx="1.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
);
export const IconLayers = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const IconBriefcase = ({ size, ...p }: P) => (
  <svg {...base(size, p)}><rect x="3" y="7" width="18" height="13" rx="1.5" /><path d="M9 7V4.5h6V7M3 12.5h18" /></svg>
);
