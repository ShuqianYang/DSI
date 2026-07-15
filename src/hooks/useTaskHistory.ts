"use client";

import { useCallback, useEffect, useState } from "react";
import type { BorderDefenseMode, BorderTaskItem } from "@/components/border-defense/types";

const LIMIT = 100;

function sortTasks(tasks: BorderTaskItem[]): BorderTaskItem[] {
  return [...tasks].sort((left, right) => right.createdAt - left.createdAt).slice(0, LIMIT);
}

export function useTaskHistory(mode: BorderDefenseMode) {
  const key = `border-defense-tasks:${mode}`;
  const [tasks, setTasks] = useState<BorderTaskItem[]>([]);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]") as BorderTaskItem[];
      setTasks(sortTasks(value.filter((item) => item.type === mode)));
    } catch {
      setTasks([]);
    }
  }, [key, mode]);

  const upsert = useCallback((item: BorderTaskItem) => {
    setTasks((current) => {
      const next = sortTasks([item, ...current.filter((task) => task.id !== item.id)]);
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  const remove = useCallback((id: string) => {
    setTasks((current) => {
      const next = sortTasks(current.filter((task) => task.id !== id));
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  const updateStatus = useCallback((id: string, status: BorderTaskItem["status"], unread?: boolean) => {
    setTasks((current) => {
      const next = sortTasks(current.map((task) => task.id === id ? {
        ...task,
        status,
        updatedAt: Date.now(),
        ...(unread === undefined ? {} : { unread }),
      } : task));
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  const reconcile = useCallback((id: string, update: Pick<BorderTaskItem, "status" | "createdAt" | "updatedAt"> & { completedAt?: number; unread?: boolean }) => {
    setTasks((current) => {
      const next = sortTasks(current.map((task) => task.id === id ? { ...task, ...update } : task));
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  const markViewed = useCallback((id: string) => {
    setTasks((current) => {
      const next = current.map((task) => task.id === id ? { ...task, unread: false } : task);
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  return { tasks, upsert, remove, updateStatus, reconcile, markViewed };
}
