'use client';

import * as React from 'react';
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconGripVertical } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTableToolbar } from '@/components/tables/data-table-toolbar';
import { DataTablePagination } from '@/components/tables/data-table-pagination';

declare module '@tanstack/react-table' {
  /**
   * Per-column classes, applied to the header cell and every body cell alike.
   *
   * This exists so a column can be dropped at narrow widths with
   * `hidden md:table-cell` rather than being squeezed to illegibility. Doing it
   * in CSS keeps it out of React state: there is no media-query hook, so nothing
   * differs between the server and client render, and the columns respond to a
   * window resize without a re-render.
   */
  // The two type parameters are required by the interface being augmented, even
  // though this declaration does not reference them.
  // eslint-disable-next-line no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
  }
}

const DRAG_COLUMN_ID = '__drag';
const SELECT_COLUMN_ID = '__select';

interface DataTableProps<TData extends object, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  getRowId?: (_row: TData, _index: number) => string;
  onRowClick?: (_row: TData) => void;
  toolbarFilters?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  searchPlaceholder?: string;
  enableRowSelection?: boolean;
  onRowSelectionChange?: (_rows: TData[]) => void;
  bulkActions?: (_selected: TData[]) => React.ReactNode;
  enableRowOrder?: boolean;
  onReorder?: (_data: TData[]) => void;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  pageSize?: number;
  /** Choices in the rows-per-page selector. Must contain `pageSize`. */
  pageSizeOptions?: number[];
  hideToolbar?: boolean;
  hidePagination?: boolean;
  className?: string;
}

export function DataTable<TData extends object, TValue>({
  columns,
  data,
  getRowId,
  onRowClick,
  toolbarFilters,
  toolbarActions,
  searchPlaceholder,
  enableRowSelection = false,
  onRowSelectionChange,
  bulkActions,
  enableRowOrder = false,
  onReorder,
  isLoading = false,
  emptyState,
  pageSize = 20,
  pageSizeOptions,
  hideToolbar = false,
  hidePagination = false,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState('');

  const resolvedColumns = React.useMemo<ColumnDef<TData, TValue>[]>(() => {
    const cols = [...columns];
    if (enableRowSelection) {
      cols.unshift({
        id: SELECT_COLUMN_ID,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      } as ColumnDef<TData, TValue>);
    }
    if (enableRowOrder) {
      cols.unshift({
        id: DRAG_COLUMN_ID,
        header: () => null,
        cell: ({ row }) => <DragHandle rowId={row.id} />,
        enableSorting: false,
        enableHiding: false,
      } as ColumnDef<TData, TValue>);
    }
    return cols;
  }, [columns, enableRowSelection, enableRowOrder]);

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    state: { sorting, columnFilters, rowSelection, globalFilter },
    ...(getRowId ? { getRowId } : {}),
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: enableRowOrder ? undefined : getPaginationRowModel(),
    // Searching or filtering returns to the first page. Without this a filter
    // applied from page 4 can land on an empty page that looks like "no results".
    autoResetPageIndex: true,
    initialState: { pagination: { pageSize } },
  });

  React.useEffect(() => {
    if (!onRowSelectionChange) return;
    onRowSelectionChange(table.getFilteredSelectedRowModel().rows.map((r) => r.original));
    // Intentionally only re-runs when the selection itself changes.
  }, [rowSelection]);

  const isFiltered = table.getState().columnFilters.length > 0 || !!globalFilter;

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const oldIndex = data.findIndex((_, i) => (getRowId ? getRowId(data[i], i) : String(i)) === active.id);
    const newIndex = data.findIndex((_, i) => (getRowId ? getRowId(data[i], i) : String(i)) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(data, oldIndex, newIndex));
  }

  const rows = table.getRowModel().rows;
  const selectedOriginals = table.getFilteredSelectedRowModel().rows.map((r) => r.original);

  const body = (
    <TableBody>
      {isLoading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            {resolvedColumns.map((column, j) => (
              // The placeholders honour the same per-column classes as the real
              // cells, so a column hidden at this width does not reappear as an
              // empty skeleton and change the column count mid-load.
              <TableCell key={j} className={column.meta?.className}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))
      ) : rows.length ? (
        enableRowOrder ? (
          rows.map((row) => (
            <DraggableTableRow key={row.id} rowId={row.id} onRowClick={onRowClick ? () => onRowClick(row.original) : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </DraggableTableRow>
          ))
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() && 'selected'}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))
        )
      ) : (
        <TableRow>
          <TableCell colSpan={resolvedColumns.length} className="h-40 text-center">
            {emptyState ?? <span className="text-sm text-muted-foreground">No results.</span>}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );

  return (
    <div className={cn('space-y-3', className)}>
      {/* Filters live above the table, not inside its card, so the surface below
          holds data only — same arrangement as the projects listing. */}
      {!hideToolbar && (
        <DataTableToolbar
          searchValue={globalFilter}
          onSearchChange={setGlobalFilter}
          searchPlaceholder={searchPlaceholder}
          isFiltered={isFiltered}
          onResetFilters={() => {
            setColumnFilters([]);
            setGlobalFilter('');
          }}
          filters={toolbarFilters}
          actions={
            enableRowSelection && selectedOriginals.length > 0 && bulkActions
              ? bulkActions(selectedOriginals)
              : toolbarActions
          }
        />
      )}
      {/* No card around the table: plain rows separated by hairlines, per the
          shadcn table pattern. The page background shows through. */}
      <div>
        <div className="max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.className}
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : header.column.getCanSort()
                            ? 'none'
                            : undefined
                    }
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          {enableRowOrder ? (
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
              sensors={sensors}
            >
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {body}
              </SortableContext>
            </DndContext>
          ) : (
            body
          )}
        </Table>
        </div>
        {!hidePagination && !enableRowOrder && (
          <DataTablePagination table={table} {...(pageSizeOptions ? { pageSizeOptions } : {})} />
        )}
      </div>
    </div>
  );
}

function DragHandle({ rowId }: { rowId: string }) {
  const { attributes, listeners } = useSortable({ id: rowId });
  return (
    <button
      {...attributes}
      {...listeners}
      className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
      aria-label="Drag to reorder"
    >
      <IconGripVertical className="h-4 w-4" />
    </button>
  );
}

function DraggableTableRow({
  rowId,
  onRowClick,
  children,
}: {
  rowId: string;
  onRowClick?: () => void;
  children: React.ReactNode;
}) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({ id: rowId });

  return (
    <TableRow
      ref={setNodeRef}
      onClick={onRowClick}
      className={cn(onRowClick && 'cursor-pointer', isDragging && 'relative z-10 opacity-80')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children}
    </TableRow>
  );
}
