"use client";

import { TableCell, TableRow } from "@/components/ui/table";

interface SkeletonProps {
  rowCount?: number;
  columnCount?: number;
}

export function UserTableSkeleton({ rowCount = 50 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: rowCount }).map((_, index) => (
        <TableRow key={index} className="animate-pulse">
          {/* User ID column */}
          <TableCell>
            <div className="h-6 bg-neutral-800 rounded w-32 font-mono"></div>
          </TableCell>
          {/* Name column */}
          <TableCell>
            <div className="h-6 bg-neutral-800 rounded w-24"></div>
          </TableCell>
          {/* Email column */}
          <TableCell>
            <div className="h-6 bg-neutral-800 rounded w-48"></div>
          </TableCell>
          {/* Role column */}
          <TableCell>
            <div className="h-6 bg-neutral-800 rounded w-16"></div>
          </TableCell>
          {/* Created At column */}
          <TableCell>
            <div className="h-6 bg-neutral-800 rounded w-24"></div>
          </TableCell>
          {/* Action column */}
          <TableCell>
            <div className="h-8 bg-neutral-800 rounded w-28"></div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
