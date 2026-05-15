import { AlertCircle, CheckCircle2, Download, Languages, Loader2 } from "lucide-react";

import type { DownloadFormat, JobRecord } from "../types";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Progress } from "./ui/Progress";

interface DownloadOption
{
    format: DownloadFormat;
    url: string;
}

interface JobStatusProps
{
    downloadOptions?: DownloadOption[];
    downloadLabel?: string;
    job: JobRecord;
    onAction?: () => void;
    onCancel?: () => void;
    onRetry?: () => void;
    title: string;
    type: "download" | "translate";
}

export function JobStatus(
{
    downloadOptions,
    downloadLabel = "Tải truyện",
    job,
    onAction,
    onCancel,
    onRetry,
    title,
    type
}: JobStatusProps): React.JSX.Element
{
    const isPlaceholderJob = job.id === "pending";
    const isRunning = !isPlaceholderJob && (job.status === "running" || job.status === "queued");
    const isCompleted = job.status === "completed";
    const isFailed = job.status === "failed";
    const isCanceled = job.status === "canceled";
    const description = isPlaceholderJob
        ? job.progress.message || "Sẵn sàng tải"
        : job.status === "queued"
            ? "Đang chờ trong hàng đợi..."
            : job.progress.message || "Đang xử lý...";
    const Icon = type === "download" ? Download : Languages;

    return (
        <Card className="overflow-hidden border-none bg-secondary/50 shadow-md backdrop-blur-sm dark:bg-secondary/20">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2 ${isCompleted ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"}`}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{title}</CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </div>
                    </div>
                    {isRunning && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                    {isCompleted && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                    {(isFailed || isCanceled) && <AlertCircle className="h-5 w-5 text-destructive" />}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <div className="flex justify-between text-sm font-medium">
                        <span>Tiến độ</span>
                        <span>{job.progress.percent}%</span>
                    </div>
                    <Progress value={job.progress.percent} className="h-2" />
                    <div className="flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
                        <span>{isPlaceholderJob ? "sẵn sàng" : job.status}</span>
                        <span>{job.progress.current} / {job.progress.total}</span>
                    </div>
                </div>

                {isCompleted && downloadOptions && downloadOptions.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                        {downloadOptions.map((option) => (
                            <a
                                key={option.format}
                                href={option.url}
                                rel="noopener noreferrer"
                                target="_blank"
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                            >
                                <Download className="h-4 w-4" />
                                {downloadLabel}
                            </a>
                        ))}
                    </div>
                )}

                {type === "download" && isPlaceholderJob && onAction && (
                    <Button variant="primary" onClick={onAction} className="w-full gap-2">
                        <Download className="h-4 w-4" />
                        {downloadLabel}
                    </Button>
                )}

                {(job.status === "queued" || job.status === "running") && onCancel && (
                    <Button variant="outline" onClick={onCancel} className="w-full">
                        Hủy job
                    </Button>
                )}

                {isCompleted && type === "download" && onAction && (
                    <Button variant="secondary" onClick={onAction} className="w-full gap-2">
                        <Languages className="h-4 w-4" />
                        Dịch sang tiếng Việt
                    </Button>
                )}

                {(isFailed || isCanceled) && onRetry && (
                    <Button variant="secondary" onClick={onRetry} className="w-full">
                        Thử lại
                    </Button>
                )}

                {(isFailed || isCanceled) && job.error && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                        <strong>Lỗi:</strong> {job.error}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
