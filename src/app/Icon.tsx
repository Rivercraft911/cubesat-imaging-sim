const paths = {
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  export: <><path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7" /></>,
  settings: <><path d="M4 7h7m5 0h4M4 17h3m5 0h8" /><circle cx="13.5" cy="7" r="2.5" /><circle cx="9.5" cy="17" r="2.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.5" /></>,
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
