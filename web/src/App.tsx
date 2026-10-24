import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";
import { createQueryClient } from "@/api/queries";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AskProvider } from "@/ask/AskStore";
import { LanguageProvider } from "@/i18n";
import { router } from "./router";

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster>
            <AskProvider>
              <RouterProvider router={router} />
            </AskProvider>
          </Toaster>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
