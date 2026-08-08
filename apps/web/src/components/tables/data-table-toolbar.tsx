import { IconX } from '@tabler/icons-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface DataTableToolbarProps {
  searchValue?: string;
  onSearchChange?: (_value: string) => void;
  searchPlaceholder?: string;
  isFiltered?: boolean;
  onResetFilters?: () => void;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
}

export function DataTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  isFiltered,
  onResetFilters,
  filters,
  actions,
}: DataTableToolbarProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange && (
          <Input
            value={searchValue ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            /* Grows on wide screens so a descriptive placeholder ("Search
               reports, projects or assessments…") is not truncated mid-word.
               Full width on mobile, unchanged at sm. */
            className="h-9 w-full border-border/70 bg-card shadow-none sm:w-64 lg:w-80"
          />
        )}
        {filters}
        {isFiltered && onResetFilters && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-muted-foreground" onClick={onResetFilters}>
            Reset
            <IconX className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
