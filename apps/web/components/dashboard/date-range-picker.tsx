"use client";

import { format } from "date-fns";
import { CalendarDays } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDashboardStore } from "@/stores/dashboard-store";

export function DateRangePicker() {
  const dateRange = useDashboardStore((state) => state.dateRange);
  const selectedRange = useDashboardStore((state) => state.selectedRange);
  const setDateRange = useDashboardStore((state) => state.setDateRange);

  const label =
    dateRange?.from && dateRange?.to
      ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d")}`
      : "Choose a range";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start gap-3 rounded-2xl px-4 text-left">
          <CalendarDays className="size-4 text-primary" />
          <div className="flex flex-col items-start leading-none">
            <span>{label}</span>
            <span className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Synced to {selectedRange}</span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="end">
        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
      </PopoverContent>
    </Popover>
  );
}
