import React from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";

interface NovelSearchProps {
  input: string;
  setInput: (val: string) => void;
  onResolve: () => void;
  busy: boolean;
  error?: string;
}

export function NovelSearch({
  input,
  setInput,
  onResolve,
  busy,
  error
}: NovelSearchProps) {
  return (
    <Card className="glass overflow-hidden">
      <CardHeader>
        <CardTitle className="text-xl">Tìm truyện mới</CardTitle>
        <CardDescription>
          Dán link truyện từ Fanqie hoặc nhập Book ID để bắt đầu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onResolve();
          }}
          className="space-y-4"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://fanqienovel.com/page/712345..."
                className="pl-10"
              />
            </div>
            <Button type="submit" disabled={busy || !input.trim()} className="w-full sm:w-auto min-w-[120px]">
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

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20 animate-in slide-in-from-top-1">
              {error}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
