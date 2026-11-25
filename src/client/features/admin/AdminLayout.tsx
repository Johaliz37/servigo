import { ChevronsUpDownIcon, ExternalLinkIcon, KeyRoundIcon, LogOutIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ROLE_LABELS } from '@shared/permissions';
import { Button } from '@client/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Separator } from '@client/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@client/components/ui/sidebar';
import { useCompany } from '@client/app/tenant-context';
import { useSystemDarkMode } from '@client/hooks/use-system-dark-mode';
import { useMembership } from '@client/features/auth/membership';
import { signOut, useSession } from '@client/features/auth/session';
import { BranchProvider, useSelectedBranch } from './branch-context';
import { ADMIN_NAV } from './nav';
import { usePurgePublicOnSave } from './purge-public';
import { RequireMember } from './RequireMember';

const ALL = '__all__';

function BranchSelector() {
  const { branches, selectedId, select, loading } = useSelectedBranch();
  if (loading || branches.length === 0) return null;
  if (branches.length === 1) {
    return <span className="truncate text-sm text-muted-foreground">Sede: {branches[0]?.name}</span>;
  }
  return (
    <Select value={selectedId ?? ALL} onValueChange={(v) => select(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className="w-48" aria-label="Sede">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas las sedes</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
            {!b.isActive && ' (inactiva)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompanyBrand() {
  const company = useCompany();
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      {company.logoUrl ? (
        <img src={company.logoUrl} alt="" className="size-8 shrink-0 rounded-md object-contain" />
      ) : (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
        >
          {company.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">{company.name}</span>
    </div>
  );
}

function UserMenu() {
  const { session } = useSession();
  const { role } = useMembership();
  const navigate = useNavigate();
  const email = session?.user.email ?? '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase"
          >
            {email.charAt(0)}
          </span>
          <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{email}</span>
            <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[role]}</span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4" aria-hidden />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/admin/cuenta')}>
          <KeyRoundIcon aria-hidden /> Cambiar contraseña
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void signOut().then(() => navigate('/admin/login', { replace: true }));
          }}
        >
          <LogOutIcon aria-hidden /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AdminSidebar() {
  const { can } = useMembership();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <CompanyBrand />
      </SidebarHeader>
      <SidebarContent>
        {ADMIN_NAV.map((group) => {
          const items = group.items.filter((item) => can(item.action));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const to = item.path ? `/admin/${item.path}` : '/admin';
                    const active = item.path
                      ? pathname.startsWith(to)
                      : pathname === '/admin' || pathname === '/admin/';
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <NavLink to={to} end={!item.path} onClick={() => isMobile && setOpenMobile(false)}>
                            <item.icon aria-hidden />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AdminShell() {
  useSystemDarkMode();
  usePurgePublicOnSave();
  return (
    <BranchProvider>
      <SidebarProvider>
        <AdminSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <BranchSelector />
            <div className="ml-auto">
              <Button variant="outline" size="sm" asChild>
                <Link to="/" target="_blank" rel="noopener">
                  <ExternalLinkIcon aria-hidden />
                  <span className="hidden sm:inline">Ver sitio público</span>
                  <span className="sr-only sm:hidden">Ver sitio público</span>
                </Link>
              </Button>
            </div>
          </header>
          <div className="flex-1 p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BranchProvider>
  );
}

/** Layout de `/admin/*`: exige ser miembro de la empresa del subdominio. */
export function Component() {
  return (
    <RequireMember>
      <AdminShell />
    </RequireMember>
  );
}
