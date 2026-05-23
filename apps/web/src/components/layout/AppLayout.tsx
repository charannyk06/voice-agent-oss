"use client";

import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { LayoutProvider } from "./LayoutContext";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </LayoutProvider>
  );
}
