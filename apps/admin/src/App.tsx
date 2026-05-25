import { useEffect, useState } from "react";
import { RefreshCw, Shield } from "lucide-react";

import { getAdminOverview } from "../../frontend/src/api";
import type { AdminOverview } from "../../frontend/src/types";
import { AdminDashboard } from "../../frontend/src/components/AdminDashboard";
import { ThemeToggle } from "../../frontend/src/components/ThemeToggle";
import { Button } from "../../frontend/src/components/ui/Button";

export function App(): React.JSX.Element
{
    const [overview, setOverview] = useState<AdminOverview>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() =>
    {
        void refreshOverviewAsync();

        const timer = window.setInterval(() =>
        {
            void refreshOverviewAsync();
        }, 5_000);

        return () => window.clearInterval(timer);
    }, []);

    const refreshOverviewAsync = async (): Promise<void> =>
    {
        try
        {
            setBusy(true);
            setError("");
            setOverview(await getAdminOverview());
        }
        catch (caught)
        {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
        finally
        {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
            <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                            <Shield className="h-6 w-6" />
                        </div>
                        <div>
                            <div className="text-lg font-bold tracking-tight">
                                Novel Grabber <span className="text-primary">Admin</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                Cổng quản trị riêng
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => void refreshOverviewAsync()} disabled={busy} className="gap-2">
                            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                            Làm mới
                        </Button>
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <main className="container space-y-4 py-8 md:py-12">
                <div className="rounded-xl border bg-secondary/30 p-4 text-sm text-muted-foreground">
                    Trang này chỉ dành cho quản trị và chạy trên cổng riêng. Nếu bạn đang ở cổng người dùng,
                    đây là nơi đúng để xem thống kê hệ thống.
                </div>

                {error && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <AdminDashboard busy={busy} overview={overview} onRefresh={() => void refreshOverviewAsync()} />
            </main>
        </div>
    );
}
