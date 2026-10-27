import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";

export default function Home() {
  return (
    <Suspense>
      
        <AppShell />
      
    </Suspense>
  );
}
