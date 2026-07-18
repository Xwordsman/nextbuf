"use client";

import { Camera, LoaderCircle, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import { Switch } from "@/components/shadcn/ui/switch";
import { Textarea } from "@/components/shadcn/ui/textarea";

type ProfileSettingsProps = {
  profile: {
    name: string;
    username: string;
    uid: number;
    image: string | null;
    initials: string;
    bio: string;
    website: string;
    isPublic: boolean;
    showActivity: boolean;
    usernameAvailableAt: string | null;
    deletionScheduledAt: string | null;
  };
};

async function requestJson(url: string, method: "PATCH" | "POST", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.code ?? "request_failed"));
  return result;
}

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : "request_failed";
  const messages: Record<string, string> = {
    invalid_profile: "请检查昵称、简介和主页地址。",
    invalid_username: "用户名需为 3-24 位小写字母、数字或单下划线，并以字母开头。",
    reserved_username: "该用户名为系统保留名称。",
    username_unavailable: "该用户名已被使用或由历史用户保留。",
    username_cooldown: "用户名仍在 30 天修改冷却期内。",
    invalid_avatar: "请选择有效的 PNG、JPEG 或 WebP 图片。",
    avatar_too_large: "裁剪后的头像文件过大。",
  };
  return messages[code] ?? "保存失败，请稍后重试。";
}

export function ProfileSettings({ profile }: ProfileSettingsProps) {
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [showActivity, setShowActivity] = useState(profile.showActivity);
  const [avatarSource, setAvatarSource] = useState("");
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(
    () => () => {
      if (avatarSource) URL.revokeObjectURL(avatarSource);
    },
    [avatarSource],
  );

  const finish = (text: string) => {
    setPending("");
    setMessage(text);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending("profile");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/account/profile", "PATCH", {
        name: form.get("name"),
        bio: form.get("bio"),
        website: form.get("website"),
      });
      finish("资料已保存。");
      window.location.reload();
    } catch (error) {
      finish(messageFor(error));
    }
  };

  const saveUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending("username");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/account/username", "PATCH", { username: form.get("username") });
      finish("用户名已更新，旧用户名链接会继续跳转到当前主页。");
      window.location.reload();
    } catch (error) {
      finish(messageFor(error));
    }
  };

  const chooseAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10_485_760) {
      setMessage("请选择不超过 10 MB 的图片。");
      return;
    }
    if (avatarSource) URL.revokeObjectURL(avatarSource);
    setAvatarSource(URL.createObjectURL(file));
    setZoom(1);
  };

  const uploadAvatar = async () => {
    const image = imageRef.current;
    if (!image) return;
    setPending("avatar");
    setMessage("");
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return finish("浏览器无法处理该图片。");
    const crop = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const sourceX = (image.naturalWidth - crop) / 2;
    const sourceY = (image.naturalHeight - crop) / 2;
    context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.88),
    );
    if (!blob) return finish("浏览器无法生成头像文件。");

    const form = new FormData();
    form.set("avatar", new File([blob], "avatar.webp", { type: "image/webp" }));
    const response = await fetch("/api/account/avatar", { method: "POST", body: form });
    const result = (await response.json().catch(() => ({}))) as { code?: string };
    if (!response.ok) return finish(messageFor(new Error(result.code ?? "request_failed")));
    finish("头像已更新。");
    window.location.reload();
  };

  const savePrivacy = async () => {
    setPending("privacy");
    try {
      await requestJson("/api/account/privacy", "PATCH", { isPublic, showActivity });
      finish("隐私设置已保存。");
    } catch (error) {
      finish(messageFor(error));
    }
  };

  const updateDeletion = async (action: "request" | "cancel") => {
    setPending("deletion");
    try {
      await requestJson("/api/account/deletion", "POST", { action });
      finish(action === "request" ? "注销申请已提交，14 天内可以撤销。" : "注销申请已撤销。");
      window.location.reload();
    } catch (error) {
      finish(messageFor(error));
    }
  };

  return (
    <div className="grid gap-0">
      <section className="grid gap-5 border-b py-7 first:pt-6" aria-labelledby="avatar-title">
        <div className="grid gap-1">
          <h2 id="avatar-title" className="text-sm font-medium text-foreground">
            头像
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            图片会在浏览器中裁剪为正方形后上传。
          </p>
        </div>
        <div className="flex flex-col gap-5 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-full border bg-background">
            {avatarSource ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imageRef}
                src={avatarSource}
                alt="头像裁剪预览"
                className="size-full object-cover"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <Avatar className="size-full">
                <AvatarImage src={profile.image ?? undefined} alt={profile.name} />
                <AvatarFallback>{profile.initials}</AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="grid min-w-0 flex-1 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="avatar-file">选择图片</Label>
              <Input
                id="avatar-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={chooseAvatar}
              />
            </div>
            {avatarSource ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="avatar-zoom">缩放</Label>
                  <input
                    id="avatar-zoom"
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </div>
                <div>
                  <Button type="button" onClick={uploadAvatar} disabled={Boolean(pending)}>
                    {pending === "avatar" ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Camera aria-hidden="true" />
                    )}
                    上传头像
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-5 border-b py-7" aria-labelledby="profile-title">
        <div className="grid gap-1">
          <h2 id="profile-title" className="text-sm font-medium text-foreground">
            公开资料
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            昵称可以重复，用户名用于唯一识别。
          </p>
        </div>
        <form className="grid max-w-2xl gap-4" onSubmit={saveProfile}>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-name">昵称</Label>
            <Input
              id="profile-name"
              name="name"
              defaultValue={profile.name}
              minLength={2}
              maxLength={40}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-bio">简介</Label>
            <Textarea id="profile-bio" name="bio" defaultValue={profile.bio} maxLength={500} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-website">个人主页</Label>
            <Input
              id="profile-website"
              name="website"
              type="url"
              defaultValue={profile.website}
              placeholder="https://example.com"
            />
          </div>
          <div>
            <Button type="submit" disabled={Boolean(pending)}>
              {pending === "profile" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              保存资料
            </Button>
          </div>
        </form>
      </section>

      <section className="grid gap-5 border-b py-7" aria-labelledby="username-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="username-title" className="text-sm font-medium text-foreground">
              用户名
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              当前主页：/u/{profile.username}
            </p>
          </div>
          <Badge variant="secondary" className="rounded-md tabular-nums">
            UID {profile.uid}
          </Badge>
        </div>
        <form
          className="grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          onSubmit={saveUsername}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="profile-username">@username</Label>
            <Input
              id="profile-username"
              name="username"
              defaultValue={profile.username}
              minLength={3}
              maxLength={24}
              pattern="[a-z](?:[a-z0-9]|_(?!_)){1,22}[a-z0-9]"
              disabled={Boolean(profile.usernameAvailableAt)}
              required
            />
          </div>
          <Button type="submit" disabled={Boolean(pending) || Boolean(profile.usernameAvailableAt)}>
            {pending === "username" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            修改
          </Button>
        </form>
        {profile.usernameAvailableAt ? (
          <p className="text-xs leading-5 text-muted-foreground">
            可再次修改时间：{new Date(profile.usernameAvailableAt).toLocaleString("zh-CN")}
          </p>
        ) : null}
      </section>

      <section className="grid gap-5 border-b py-7" aria-labelledby="privacy-title">
        <div className="grid gap-1">
          <h2 id="privacy-title" className="text-sm font-medium text-foreground">
            隐私
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">邮箱始终不会显示在公开用户页。</p>
        </div>
        <div className="grid max-w-2xl gap-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3.5">
            <div className="grid gap-0.5">
              <Label htmlFor="profile-public" className="text-sm font-medium">
                公开个人资料
              </Label>
              <p className="text-xs leading-5 text-muted-foreground">关闭后只显示基本身份信息。</p>
            </div>
            <Switch
              id="profile-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
              aria-label="公开个人资料"
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3.5">
            <div className="grid gap-0.5">
              <Label htmlFor="profile-show-activity" className="text-sm font-medium">
                显示活动统计
              </Label>
              <p className="text-xs leading-5 text-muted-foreground">
                主题与回复上线后会遵循此设置。
              </p>
            </div>
            <Switch
              id="profile-show-activity"
              checked={showActivity}
              onCheckedChange={setShowActivity}
              aria-label="显示活动统计"
            />
          </div>
        </div>
        <div>
          <Button type="button" variant="outline" onClick={savePrivacy} disabled={Boolean(pending)}>
            {pending === "privacy" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            保存隐私设置
          </Button>
        </div>
      </section>

      <section className="grid gap-5 border-b py-7" aria-labelledby="notifications-title">
        <div className="grid gap-1">
          <h2 id="notifications-title" className="text-sm font-medium text-foreground">
            通知偏好
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">暂无可配置的通知渠道。</p>
        </div>
        <div className="flex max-w-2xl items-start justify-between gap-4 rounded-lg border border-dashed p-3.5 opacity-70">
          <div className="grid gap-0.5">
            <Label htmlFor="profile-notifications" className="text-sm font-medium">
              站内通知
            </Label>
            <p className="text-xs leading-5 text-muted-foreground">通知系统启用后可在此管理。</p>
          </div>
          <Switch id="profile-notifications" checked={false} disabled aria-label="站内通知" />
        </div>
      </section>

      <section className="grid gap-4 py-7" aria-labelledby="deletion-title">
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center">
          <div className="grid gap-1">
            <h2 id="deletion-title" className="text-sm font-medium text-foreground">
              注销账号
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {profile.deletionScheduledAt
                ? `计划处理时间：${new Date(profile.deletionScheduledAt).toLocaleString("zh-CN")}`
                : "提交后有 14 天撤销期，当前阶段不会立即清除内容。"}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => updateDeletion(profile.deletionScheduledAt ? "cancel" : "request")}
            disabled={Boolean(pending)}
          >
            {pending === "deletion" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : profile.deletionScheduledAt ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {profile.deletionScheduledAt ? "撤销申请" : "申请注销"}
          </Button>
        </div>
      </section>

      {message ? (
        <Alert role="status" className="mb-6">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
