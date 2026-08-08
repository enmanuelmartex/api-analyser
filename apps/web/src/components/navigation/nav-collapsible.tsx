"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconChevronRight } from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NAV_COLLAPSIBLE,
  isGroupActive,
  isLeafActive,
} from "@/components/navigation/nav-data";

export function NavCollapsible({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { state, isMobile } = useSidebar();
  const showSubmenus = state === "expanded" || isMobile;

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_COLLAPSIBLE.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || isAdmin,
            );
            const groupActive = isGroupActive(pathname, search, group);

            /*
             * Collapsed rail: the submenu is not rendered, so the trigger below
             * would toggle a panel that does not exist and Settings would be
             * unreachable without expanding the sidebar first. A flyout keeps
             * every section one click away, with the same Administration
             * subdivision.
             */
            if (!showSubmenus) {
              return (
                <SidebarMenuItem key={group.title}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton tooltip={group.title} isActive={groupActive}>
                        <group.icon />
                        <span>{group.title}</span>
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="min-w-48">
                      <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                      {visibleItems.map((item, index) => {
                        const active = isLeafActive(pathname, search, item);
                        const startsSection =
                          !!item.section && item.section !== visibleItems[index - 1]?.section;
                        return (
                          <div key={item.url}>
                            {startsSection && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                  {item.section}
                                </DropdownMenuLabel>
                              </>
                            )}
                            <DropdownMenuItem asChild>
                              <Link
                                href={item.url}
                                aria-current={active ? 'page' : undefined}
                                className={active ? 'bg-accent text-accent-foreground' : undefined}
                              >
                                <item.icon />
                                <span>{item.title}</span>
                              </Link>
                            </DropdownMenuItem>
                          </div>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            }

            return (
              <Collapsible
                key={group.title}
                defaultOpen={groupActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={group.title}
                      isActive={groupActive}
                    >
                      <group.icon />
                      <span>{group.title}</span>
                      {showSubmenus && (
                        <IconChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      )}
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {showSubmenus && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleItems.map((item, index) => {
                          const active = isLeafActive(pathname, search, item);
                          // Heading above the first item of each subdivision.
                          const startsSection =
                            !!item.section && item.section !== visibleItems[index - 1]?.section;
                          return (
                            <div key={item.url}>
                              {startsSection && (
                                <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                  {item.section}
                                </p>
                              )}
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton asChild isActive={active}>
                                  <Link href={item.url} aria-current={active ? 'page' : undefined}>
                                    <item.icon />
                                    <span>{item.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            </div>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </SidebarMenuItem>
              </Collapsible>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
