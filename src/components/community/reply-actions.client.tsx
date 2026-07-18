"use client";

import { FilePenLine, LoaderCircle, Quote, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { MarkdownEditor } from "@/components/community/markdown-editor.client";
import { Button } from "@/components/shadcn/ui/button";
import { PostLikeButton } from "@/components/interactions/post-like-button.client";
import { ReportDialog } from "@/components/moderation/report-dialog.client";

type ReplyActionsProps = {
  topicNumber: number;
  position: number;
  authorName: string;
  body: string;
  quotedPosition: number | null;
  canQuote: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRestore: boolean;
  bodyMax: number;
  postId: string;
  liked: boolean;
  likeCount: number;
  canLike: boolean;
  signedIn: boolean;
};

export function ReplyActions({
  topicNumber,
  position,
  authorName,
  body: initialBody,
  quotedPosition,
  canQuote,
  canEdit,
  canDelete,
  canRestore,
  bodyMax,
  postId,
  liked,
  likeCount,
  canLike,
  signedIn,
}: ReplyActionsProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  const action = async (kind: "save" | "delete" | "restore") => {
    if (kind === "delete" && !window.confirm(`确定删除 #${position} 的回复吗？`)) return;
    setPending(kind);
    setMessage("");
    const response = await fetch(`/api/community/topics/${topicNumber}/posts/${position}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: kind,
        ...(kind === "save" ? { body, quotedPosition } : {}),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { code?: string };
    if (!response.ok) {
      setMessage(
        result.code === "invalid_post" ? "回复内容不符合要求。" : "操作失败，请稍后再试。",
      );
      setPending("");
      return;
    }
    window.location.reload();
  };

  if (editing) {
    return (
      <div className="grid gap-3">
        <MarkdownEditor
          id={`reply-edit-${position}`}
          name="body"
          value={body}
          onChange={setBody}
          maxLength={bodyMax}
          disabled={Boolean(pending)}
          ariaLabel={`编辑第 ${position} 楼回复`}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            <X /> 取消
          </Button>
          <Button type="button" onClick={() => action("save")} disabled={Boolean(pending)}>
            {pending === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
            保存修改
          </Button>
        </div>
        {message ? (
          <p className="text-sm text-destructive" role="status">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <PostLikeButton
        postId={postId}
        initialLiked={liked}
        initialCount={likeCount}
        canInteract={canLike}
        signInHref={`/auth/sign-in?next=/topics/${topicNumber}`}
      />
      <ReportDialog
        target={{ type: "post", number: topicNumber, position }}
        signedIn={signedIn}
        signInHref={`/auth/sign-in?next=/topics/${topicNumber}`}
      />
      {canQuote ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("nextbuf:quote-reply", { detail: { position, authorName } }),
            )
          }
        >
          <Quote /> 引用
        </Button>
      ) : null}
      {canEdit ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <FilePenLine /> 编辑
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => action("delete")}
          disabled={Boolean(pending)}
        >
          {pending === "delete" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
          删除
        </Button>
      ) : null}
      {canRestore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => action("restore")}
          disabled={Boolean(pending)}
        >
          {pending === "restore" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
          恢复
        </Button>
      ) : null}
      {message ? (
        <p className="basis-full text-sm text-destructive" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
