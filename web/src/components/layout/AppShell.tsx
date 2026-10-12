import { Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Database,
  Gauge,
  LineChart,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquarePen,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { GroupPicker } from "@/components/GroupPicker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOrg } from "@/lib/org";
import { useGroups } from "@/lib/queries";
import { useLogout } from "@/lib/session";
import { storage } from "@/lib/storage";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

function useNavItems(): NavItem[] {
  const { terms } = useOrg();
  return [
    { to: "/", label: "Readiness", icon: Gauge, exact: true },
    { to: "/athletes", label: terms.athletes, icon: Users },
    { to: "/groups", label: terms.groups, icon: Network },
    { to: "/forms", label: "Forms", icon: ClipboardList },
    { to: "/entry", label: "Data entry", icon: SquarePen },
    { to: "/data", label: "Data", icon: Database },
    { to: "/metrics", label: "Metrics", icon: LineChart },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
}

function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [pref, setPref] = useState<"expanded" | "collapsed" | null>(() => {
    const v = storage.get("ams.sidebar");
    return v === "expanded" || v === "collapsed" ? v : null;
  });
  const collapsed = pref ? pref === "collapsed" : !isDesktop;
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    const next = collapsed ? "expanded" : "collapsed";
    storage.set("ams.sidebar", next);
    setPref(next);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {!isMobile && (
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
            collapsed ? "w-[52px]" : "w-56",
          )}
          aria-label="Main navigation"
        >
          <SidebarContents collapsed={collapsed} onToggle={toggle} />
        </aside>
      )}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContents collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={isMobile ? () => setMobileOpen(true) : undefined} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function TopBar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { groupId, setGroupId, terms } = useOrg();
  const groups = useGroups();
  // Drop a remembered group that no longer exists (archived, or access removed).
  useEffect(() => {
    if (groupId && groups.data && !groups.data.some((g) => g.id === groupId)) setGroupId(null);
  }, [groupId, groups.data, setGroupId]);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      {onOpenMenu && (
        <Button variant="ghost" size="icon-sm" onClick={onOpenMenu} aria-label="Open navigation">
          <Menu />
        </Button>
      )}
      <span className="hidden text-xs text-muted-foreground sm:inline">{terms.group}</span>
      <GroupPicker
        aria-label={`${terms.group} filter`}
        groups={groups.data ?? []}
        value={groupId}
        onChange={setGroupId}
        allLabel={`All ${terms.groups.toLowerCase()}`}
        size="sm"
        className="h-7 w-48 sm:w-60"
      />
      <div className="ml-auto flex items-center gap-1">
        <ThemeMenu />
      </div>
    </header>
  );
}

function ThemeMenu() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeSetting)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContents({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const items = useNavItems();
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-11 items-center border-b border-sidebar-border", collapsed ? "justify-center px-1.5" : "px-2")}>
        <OrgSwitcher collapsed={collapsed} />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {items.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className={cn("flex flex-col gap-1 border-t border-sidebar-border p-1.5")}>
        <UserMenu collapsed={collapsed} />
        {onToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn("text-muted-foreground", collapsed ? "w-full px-0" : "justify-start")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsed && <span>Collapse</span>}
          </Button>
        )}
      </div>
    </div>
  );
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      activeOptions={{ exact: item.exact ?? false }}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 opacity-80 group-data-[status=active]:opacity-100" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, org, switchOrg, role } = useOrg();
  const navigate = useNavigate();
  const multiple = me.memberships.length > 1;
  const badge = (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
      {initials(org.name)}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Switch organization"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40",
            !collapsed && "w-full",
          )}
        >
          {badge}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{org.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground capitalize">{role}</span>
              </span>
              {multiple && <ChevronsUpDown aria-hidden className="size-3.5 text-muted-foreground" />}
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me.memberships.map((m) => (
          <DropdownMenuItem
            key={m.org.id}
            onSelect={() => {
              if (m.org.id !== org.id) {
                switchOrg(m.org.id);
                void navigate({ to: "/" });
              }
            }}
          >
            <Building2 />
            <span className="flex-1 truncate">{m.org.name}</span>
            <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
            {m.org.id === org.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { me } = useOrg();
  const logout = useLogout();
  const navigate = useNavigate();
  const name = me.user.full_name || me.user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40",
            collapsed ? "justify-center" : "w-full",
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
            {initials(name)}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{me.user.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{me.user.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/settings", search: { tab: "account" } })}>
          <Settings /> Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            void navigate({ to: "/login" });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
