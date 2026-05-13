import React from "react";
import { Download, Languages, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { Progress } from "./ui/Progress";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import type { JobRecord } from "../types";

interface JobStatusProps {
  job: JobRecord;
  title: string;
  type: "download" | "translate";
  onAction?: () => void;
  downloadUrl?: string;
  formatLabel?: string;
}

export function JobStatus({
  job,
  title,
  type,
  onAction,
  downloadUrl,
  formatLabel
}: JobStatusProps) {
  const isPlaceholderJob = job.id === "pending";
  const isRunning = job.status === "running" || job.status === "queued";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const description = isPlaceholderJob
    ? job.progress.message || "Sẵn sàng tải"
    : job.status === "queued"
      ? "Đang chờ trong hàng đợi..."
      : job.progress.message || "Đang xử lý...";

  const Icon = type === "download" ? Download : Languages;

  return (
    <Card className="border-none shadow-md overflow-hidden bg-secondary/50 dark:bg-secondary/20 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isCompleted ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground'}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>
                {description}
              </CardDescription>
            </div>
          </div>
          {isRunning && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {isCompleted && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          {isFailed && <AlertCircle className="h-5 w-5 text-destructive" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-medium">
            <span>Tiến độ</span>
            <span>{job.progress.percent}%</span>
          </div>
          <Progress value={job.progress.percent} className="h-2" />
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase tracking-wider">
            <span>{isPlaceholderJob ? "sẵn sàng" : job.status}</span>
            <span>{job.progress.current} / {job.progress.total}</span>
          </div>
        </div>

        {isCompleted && downloadUrl && (
          <div className="pt-2">
            <a 
              href={downloadUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-2"
            >
              <Download className="h-4 w-4" />
              Tải file {formatLabel}
            </a>
          </div>
        )}

        {isCompleted && type === "download" && onAction && (
          <Button variant="secondary" onClick={onAction} className="w-full gap-2">
            <Languages className="h-4 w-4" />
            Dịch sang tiếng Việt
          </Button>
        )}

        {isFailed && job.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive border border-destructive/20">
            <strong>Lỗi:</strong> {job.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Add a helper for the Button component to support asChild pattern manually for now
function ButtonAsChild({ children, ...props }: any) {
    return React.cloneElement(children, { ...props, className: `${props.className} ${children.props.className}` });
}
