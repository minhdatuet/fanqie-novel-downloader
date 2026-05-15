import React from "react";
import { BookOpen, Download, Library, Shield } from "lucide-react";

import { ThemeToggle } from "./ThemeToggle";
import { cn } from "./ui/utils";

interface LayoutProps
{
    children: React.ReactNode;
    activeTab: "admin" | "download" | "library";
    onTabChange: (tab: "admin" | "download" | "library") => void;
}

export function Layout({ children, activeTab, onTabChange }: LayoutProps): React.JSX.Element
{
    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
            <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                            <BookOpen className="h-6 w-6" />
                        </div>
                        <span className="hidden text-xl font-bold tracking-tight sm:inline-block">
                            Tomato <span className="text-primary">Downloader</span>
                        </span>
                    </div>

                    <nav className="flex items-center gap-1 sm:gap-4">
                        <button
                            onClick={() => onTabChange("download")}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                activeTab === "download"
                                    ? "bg-secondary text-secondary-foreground"
                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                            )}
                        >
                            <Download className="h-4 w-4" />
                            <span className="hidden sm:inline">Tải truyện</span>
                        </button>
                        <button
                            onClick={() => onTabChange("library")}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                activeTab === "library"
                                    ? "bg-secondary text-secondary-foreground"
                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                            )}
                        >
                            <Library className="h-4 w-4" />
                            <span className="hidden sm:inline">Thư viện</span>
                        </button>
                        <button
                            onClick={() => onTabChange("admin")}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                activeTab === "admin"
                                    ? "bg-secondary text-secondary-foreground"
                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                            )}
                        >
                            <Shield className="h-4 w-4" />
                            <span className="hidden sm:inline">Quản trị</span>
                        </button>
                        <div className="ml-2 border-l pl-2">
                            <ThemeToggle />
                        </div>
                    </nav>
                </div>
            </header>

            <main className="container animate-in fade-in py-8 duration-500 md:py-12">
                {children}
            </main>

            <footer className="border-t py-6 md:py-0">
                <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
                    <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                        Dự án mã nguồn mở hỗ trợ tải truyện từ Fanqie.
                    </p>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">v0.1.0</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
