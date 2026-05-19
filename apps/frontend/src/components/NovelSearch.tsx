import React from "react";
import { Loader2, Search } from "lucide-react";

import type { SourceInfo } from "../types";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";

interface NovelSearchProps
{
    busy: boolean;
    error?: string;
    input: string;
    onResolve: () => void;
    selectedSourceHint?: string;
    selectedSourceId: string;
    setInput: (val: string) => void;
    setSelectedSourceId: (val: string) => void;
    sources: SourceInfo[];
}

export function NovelSearch(
    {
        busy,
        error,
        input,
        onResolve,
        selectedSourceHint,
        selectedSourceId,
        setInput,
        setSelectedSourceId,
        sources
    }: NovelSearchProps
): React.JSX.Element
{
    const selectedSource = sources.find((item) => item.id === selectedSourceId);

    return (
        <Card className="glass overflow-hidden">
            <CardHeader>
                <CardTitle className="text-xl">Tìm truyện mới</CardTitle>
                <CardDescription>
                    Chọn nguồn trước, sau đó dán link hoặc ID truyện để bắt đầu.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form
                    onSubmit={(event) =>
                    {
                        event.preventDefault();
                        onResolve();
                    }}
                    className="space-y-4"
                >
                    <div className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
                        <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Nguồn truyện
                            </span>
                            <select
                                value={selectedSourceId}
                                onChange={(event) => setSelectedSourceId(event.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                {sources.length === 0 && <option value="fanqie">Fanqie</option>}
                                {sources.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.displayName}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Link hoặc ID
                            </span>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={input}
                                    onChange={(event) => setInput(event.target.value)}
                                    placeholder={selectedSourceHint || "Dán link hoặc nhập ID truyện"}
                                    className="pl-10"
                                />
                            </div>
                        </label>

                        <Button
                            type="submit"
                            disabled={busy || !input.trim()}
                            className="w-full min-w-[120px] self-end"
                        >
                            {busy ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Đang xử lý
                                </>
                            ) : (
                                "Kiểm tra"
                            )}
                        </Button>
                    </div>

                    {selectedSource && (
                        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            Đã chọn <span className="font-semibold text-foreground">{selectedSource.displayName}</span>
                            {selectedSource.inputHint ? ` · ${selectedSource.inputHint}` : ""}
                        </div>
                    )}

                    {error && (
                        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive animate-in slide-in-from-top-1">
                            {error}
                        </div>
                    )}
                </form>
            </CardContent>
        </Card>
    );
}
