"use client";

import Link from "next/link";
import { appBrand } from "@/lib/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/navigation/nav-main";
import { NavCollapsible } from "@/components/navigation/nav-collapsible";
import { NavSecondary } from "@/components/navigation/nav-secondary";
import { NavUser } from "@/components/navigation/nav-user";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: { name: string; email: string; role: string } | null;
}

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const isAdmin = user?.role === "ADMIN";

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader className="pb-2">
        {/*
          Deliberately not a SidebarMenuButton: icon mode hides every direct
          `<span>` child of one, and the lockup IS a span — routing the brand
          through that machinery meant the logo vanished when collapsed. The
          two states swap the official artwork instead of shrinking one asset
          until the node network turns to mud.
        */}
        <Link
          href="/dashboard"
          title={appBrand.name}
          aria-label={`${appBrand.name} — go to dashboard`}
          className="flex h-12 items-center rounded-lg px-2 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <BrandLogo
            type="horizontal"
            size={34}
            className="group-data-[collapsible=icon]:hidden"
            wordmarkClassName="text-sidebar-foreground"
          />
          <BrandLogo
            type="compact"
            size={34}
            className="hidden group-data-[collapsible=icon]:inline-flex"
          />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavCollapsible isAdmin={isAdmin} />
      </SidebarContent>
      <SidebarFooter>
        <NavSecondary />
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
