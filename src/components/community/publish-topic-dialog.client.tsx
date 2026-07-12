"use client";

import { Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import type { CommunityNodeView } from "@/modules/community/contracts/home-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const topicFormSchema = z.object({
  title: z.string().trim().min(6, "标题至少需要 6 个字符").max(80, "标题不能超过 80 个字符"),
  node: z.preprocess((value) => value ?? "", z.string().min(1, "请选择节点")),
  content: z.string().trim().min(12, "内容至少需要 12 个字符").max(10_000),
});

type PublishTopicDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: CommunityNodeView[];
};

export function PublishTopicDialog({ open, onOpenChange, nodes }: PublishTopicDialogProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = topicFormSchema.safeParse({
      title: formData.get("title"),
      node: formData.get("node"),
      content: formData.get("content"),
    });

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors(
        Object.fromEntries(
          Object.entries(fieldErrors).map(([field, messages]) => [
            field,
            messages?.[0] ?? "输入无效",
          ]),
        ),
      );
      return;
    }

    setErrors({});
    onOpenChange(false);
    setToast("当前版本尚未开放发帖");
    event.currentTarget.reset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布新话题</DialogTitle>
            <DialogDescription className="sr-only">发布话题表单</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate>
            <div className="topic-form">
              <div className="form-field">
                <Label htmlFor="topic-title">标题</Label>
                <Input
                  id="topic-title"
                  name="title"
                  maxLength={80}
                  placeholder="用一句话写清想讨论的问题"
                />
                {errors.title ? <p className="field-error">{errors.title}</p> : null}
              </div>
              <div className="form-field">
                <Label htmlFor="topic-node">节点</Label>
                <select id="topic-node" name="node" defaultValue="" className="select-control">
                  <option value="" disabled>
                    选择节点
                  </option>
                  {nodes
                    .filter((node) => node.id !== "all")
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                </select>
                {errors.node ? <p className="field-error">{errors.node}</p> : null}
              </div>
              <div className="form-field">
                <Label htmlFor="topic-content">内容</Label>
                <Textarea
                  id="topic-content"
                  name="content"
                  placeholder="补充背景、尝试过的方法和期望得到的帮助"
                />
                {errors.content ? <p className="field-error">{errors.content}</p> : null}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit">
                <Send /> 发布
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast ? <div className="toast-message">{toast}</div> : null}
      </div>
    </>
  );
}
