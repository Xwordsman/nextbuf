"use client";

import Link from "next/link";
import { Flag, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ReportTarget =
  | { type: "topic"; number: number }
  | { type: "post"; number: number; position: number }
  | { type: "user"; username: string };

const errorMessages: Record<string, string> = {
  duplicate_report: "你已经举报过该目标，案件结案前无需重复提交。",
  report_rate_limited: "今天提交的举报已达到上限。",
  invalid_report: "该目标当前不可举报。",
};

export function ReportDialog({
  target,
  signedIn,
  signInHref,
}: {
  target: ReportTarget;
  signedIn: boolean;
  signInHref: string;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  if (!signedIn) {
    return (
      <Button asChild type="button" variant="ghost" size="sm">
        <Link href={signInHref}>
          <Flag /> 举报
        </Link>
      </Button>
    );
  }

  const submit = async () => {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/moderation/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, reason, details }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      code?: string;
      caseNumber?: number;
    };
    setPending(false);
    if (!response.ok) {
      setMessage(errorMessages[result.code ?? ""] ?? "举报提交失败，请稍后再试。");
      return;
    }
    setMessage(`举报已提交，案件编号 #${result.caseNumber}。`);
    setDetails("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Flag /> 举报
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>提交举报</DialogTitle>
          <DialogDescription>请选择最符合的原因，并只填写与案件判断有关的事实。</DialogDescription>
        </DialogHeader>
        <div className="moderation-report-form">
          <Label htmlFor={`${formId}-reason`}>原因</Label>
          <select
            id={`${formId}-reason`}
            className="moderation-select"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
          >
            <option value="spam">垃圾信息或广告</option>
            <option value="abuse">辱骂或恶意行为</option>
            <option value="harassment">骚扰</option>
            <option value="illegal">违法或危险内容</option>
            <option value="privacy">隐私泄露</option>
            <option value="other">其他</option>
          </select>
          <Label htmlFor={`${formId}-details`}>补充说明</Label>
          <Textarea
            id={`${formId}-details`}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={2000}
            rows={6}
            disabled={pending}
            placeholder="可选，最多 2000 字"
          />
          {message ? <p className="moderation-form-message">{message}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || message.startsWith("举报已提交")}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Flag />}
            提交举报
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
