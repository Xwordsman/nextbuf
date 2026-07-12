"use client";

import { Camera, LoaderCircle, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="settings-sections">
      <section className="settings-section" aria-labelledby="avatar-title">
        <div className="settings-section-head">
          <div>
            <h2 id="avatar-title">头像</h2>
            <p>图片会在浏览器中裁剪为正方形后上传。</p>
          </div>
        </div>
        <div className="avatar-editor">
          <div className="avatar-crop-preview">
            {avatarSource ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imageRef}
                src={avatarSource}
                alt="头像裁剪预览"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <Avatar className="size-full border-0">
                <AvatarImage src={profile.image ?? undefined} alt={profile.name} />
                <AvatarFallback>{profile.initials}</AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="avatar-editor-controls">
            <Label htmlFor="avatar-file">选择图片</Label>
            <Input
              id="avatar-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseAvatar}
            />
            {avatarSource ? (
              <>
                <Label htmlFor="avatar-zoom">缩放</Label>
                <input
                  id="avatar-zoom"
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <Button type="button" onClick={uploadAvatar} disabled={Boolean(pending)}>
                  {pending === "avatar" ? <LoaderCircle className="animate-spin" /> : <Camera />}{" "}
                  上传头像
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="profile-title">
        <div className="settings-section-head">
          <div>
            <h2 id="profile-title">公开资料</h2>
            <p>昵称可以重复，用户名用于唯一识别。</p>
          </div>
        </div>
        <form className="settings-form" onSubmit={saveProfile}>
          <div className="form-field">
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
          <div className="form-field">
            <Label htmlFor="profile-bio">简介</Label>
            <Textarea id="profile-bio" name="bio" defaultValue={profile.bio} maxLength={500} />
          </div>
          <div className="form-field">
            <Label htmlFor="profile-website">个人主页</Label>
            <Input
              id="profile-website"
              name="website"
              type="url"
              defaultValue={profile.website}
              placeholder="https://example.com"
            />
          </div>
          <Button type="submit" disabled={Boolean(pending)}>
            {pending === "profile" ? <LoaderCircle className="animate-spin" /> : <Save />} 保存资料
          </Button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="username-title">
        <div className="settings-section-head">
          <div>
            <h2 id="username-title">用户名</h2>
            <p>当前主页：/u/{profile.username}</p>
          </div>
          <span className="identity-value">UID {profile.uid}</span>
        </div>
        <form className="settings-form settings-form-inline" onSubmit={saveUsername}>
          <div className="form-field">
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
            {pending === "username" ? <LoaderCircle className="animate-spin" /> : <Save />} 修改
          </Button>
        </form>
        {profile.usernameAvailableAt ? (
          <p className="field-hint">
            可再次修改时间：{new Date(profile.usernameAvailableAt).toLocaleString("zh-CN")}
          </p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="privacy-title">
        <div className="settings-section-head">
          <div>
            <h2 id="privacy-title">隐私</h2>
            <p>邮箱始终不会显示在公开用户页。</p>
          </div>
        </div>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
          <span>
            <strong>公开个人资料</strong>
            <small>关闭后只显示基本身份信息。</small>
          </span>
        </label>
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={showActivity}
            onChange={(event) => setShowActivity(event.target.checked)}
          />
          <span>
            <strong>显示活动统计</strong>
            <small>主题与回复上线后会遵循此设置。</small>
          </span>
        </label>
        <Button type="button" variant="outline" onClick={savePrivacy} disabled={Boolean(pending)}>
          {pending === "privacy" ? <LoaderCircle className="animate-spin" /> : <Save />}{" "}
          保存隐私设置
        </Button>
      </section>

      <section className="settings-section" aria-labelledby="notifications-title">
        <div className="settings-section-head">
          <div>
            <h2 id="notifications-title">通知偏好</h2>
            <p>暂无可配置的通知渠道。</p>
          </div>
        </div>
        <label className="setting-toggle is-disabled">
          <input type="checkbox" disabled />
          <span>
            <strong>站内通知</strong>
            <small>通知系统启用后可在此管理。</small>
          </span>
        </label>
      </section>

      <section className="settings-section danger-zone" aria-labelledby="deletion-title">
        <div>
          <h2 id="deletion-title">注销账号</h2>
          <p>
            {profile.deletionScheduledAt
              ? `计划处理时间：${new Date(profile.deletionScheduledAt).toLocaleString("zh-CN")}`
              : "提交后有 14 天撤销期，当前阶段不会立即清除内容。"}
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          onClick={() => updateDeletion(profile.deletionScheduledAt ? "cancel" : "request")}
          disabled={Boolean(pending)}
        >
          {pending === "deletion" ? (
            <LoaderCircle className="animate-spin" />
          ) : profile.deletionScheduledAt ? (
            <RotateCcw />
          ) : (
            <Trash2 />
          )}
          {profile.deletionScheduledAt ? "撤销申请" : "申请注销"}
        </Button>
      </section>

      {message ? (
        <p className="settings-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
