import { notFound } from "next/navigation";
import { FeedbackState } from "@/components/states/feedback-state";

const states = {
  empty: {
    kind: "empty" as const,
    title: "这里还没有内容",
    description: "内容发布后会显示在这里。",
  },
  unauthorized: {
    kind: "unauthorized" as const,
    title: "需要登录后访问",
    description: "当前页面需要有效的登录会话。",
  },
  maintenance: {
    kind: "maintenance" as const,
    title: "正在维护",
    description: "服务暂时不可用，请稍后再试。",
  },
  unavailable: {
    kind: "empty" as const,
    title: "功能尚未开放",
    description: "当前版本暂未提供这个入口。",
  },
};

export function generateStaticParams() {
  return Object.keys(states).map((kind) => ({ kind }));
}

export default async function StatusPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const state = states[kind as keyof typeof states];

  if (!state) notFound();
  return <FeedbackState {...state} />;
}
