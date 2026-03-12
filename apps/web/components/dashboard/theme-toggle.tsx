"use client";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export function ThemeToggle() {
  return (
    <AnimatedThemeToggler className="flex size-8 items-center justify-center rounded-xl text-foreground/60 transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[15px]" />
  );
}
