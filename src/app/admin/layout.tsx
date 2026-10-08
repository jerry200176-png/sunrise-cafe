import type { ReactNode } from "react";
import { SessionGuard } from "@/components/admin/SessionGuard";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionGuard />
      {children}
    </>
  );
}
