import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGroup } from "@/contexts/GroupContext";
import { groupPath, groupKindOf, isValidGroupId, scopedKey, getGroupEmoji } from "@/lib/groups";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  Layers,
  Check,
  Trash2,
  ArrowRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface VisitedGroupItem {
  id: string;
  name: string;
  sport?: string;
  kind?: string;
  lastVisitedAt: number;
}

const STORAGE_KEY = "bun_pay_visited_groups";

export function getStoredVisitedGroups(): VisitedGroupItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredVisitedGroup(item: {
  id: string;
  name: string;
  sport?: string;
  kind?: string;
}) {
  if (typeof localStorage === "undefined" || !isValidGroupId(item.id)) return;
  try {
    const current = getStoredVisitedGroups();
    const existingIdx = current.findIndex((g) => g.id === item.id);
    const updatedItem: VisitedGroupItem = {
      id: item.id,
      name: item.name || item.id,
      sport: item.sport,
      kind: item.kind,
      lastVisitedAt: Date.now(),
    };
    let nextList: VisitedGroupItem[];
    if (existingIdx >= 0) {
      nextList = [...current];
      nextList[existingIdx] = { ...nextList[existingIdx], ...updatedItem };
    } else {
      nextList = [updatedItem, ...current];
    }
    nextList.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList.slice(0, 20)));
    localStorage.setItem("lastActiveGroupId", item.id);
  } catch {}
}

export function removeStoredVisitedGroup(groupId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const current = getStoredVisitedGroups();
    const nextList = current.filter((g) => g.id !== groupId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList));
  } catch {}
}

interface PublicGroupSwitcherProps {
  currentSubPath?: string; // e.g. "public" or "public/pay"
  className?: string;
  variant?: "default" | "on-primary";
}

export const PublicGroupSwitcher: React.FC<PublicGroupSwitcherProps> = ({
  currentSubPath = "public",
  className,
  variant = "default",
}) => {
  const navigate = useNavigate();
  const { groupId, group } = useGroup();
  const [open, setOpen] = useState(false);
  const [visitedGroups, setVisitedGroups] = useState<VisitedGroupItem[]>([]);

  // Sync current group into visited groups
  useEffect(() => {
    if (groupId && group?.name) {
      saveStoredVisitedGroup({
        id: groupId,
        name: group.name,
        sport: group.sport,
        kind: group.kind,
      });
    }
    setVisitedGroups(getStoredVisitedGroups());
  }, [groupId, group?.name, group?.sport, group?.kind]);

  const handleOpenSheet = () => {
    setVisitedGroups(getStoredVisitedGroups());
    setOpen(true);
  };

  const handleSwitch = (targetGroupId: string) => {
    if (targetGroupId === groupId) {
      setOpen(false);
      return;
    }
    try {
      localStorage.setItem("lastActiveGroupId", targetGroupId);
    } catch {}
    setOpen(false);
    navigate(groupPath(targetGroupId, currentSubPath));
  };

  const handleRemove = (e: React.MouseEvent, targetGroupId: string) => {
    e.stopPropagation();
    removeStoredVisitedGroup(targetGroupId);
    setVisitedGroups(getStoredVisitedGroups());
  };

  const otherGroupsCount = visitedGroups.filter((g) => g.id !== groupId).length;
  const currentEmoji = getGroupEmoji(group);

  return (
    <>
      <button
        type="button"
        onClick={handleOpenSheet}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-xs active:scale-95",
          variant === "on-primary"
            ? "bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm"
            : "bg-background/90 hover:bg-background text-foreground border border-border/80 hover:border-primary/50 shadow-xs",
          className
        )}
        title="Chuyển đổi giữa các nhóm bạn đã tham gia"
      >
        <span className="text-sm shrink-0">{currentEmoji}</span>
        <span className="max-w-[130px] sm:max-w-[200px] truncate font-semibold">
          {group?.name || "Bún Pay"}
        </span>
        {otherGroupsCount > 0 && (
          <span
            className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-bold shrink-0",
              variant === "on-primary"
                ? "bg-white/25 text-white"
                : "bg-primary/10 text-primary"
            )}
          >
            {visitedGroups.length} nhóm
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-70",
            variant === "on-primary" ? "text-white" : "text-muted-foreground"
          )}
        />
      </button>

      {/* Switcher Bottom Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] rounded-t-2xl sm:max-w-md sm:mx-auto p-4 sm:p-6 flex flex-col space-y-4"
        >
          <SheetHeader className="text-left space-y-1">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base sm:text-lg font-bold flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                <span>Nhóm của bạn</span>
              </SheetTitle>
              <Badge variant="outline" className="text-xs bg-muted/50">
                {visitedGroups.length} nhóm trên thiết bị
              </Badge>
            </div>
            <SheetDescription className="text-xs text-muted-foreground">
              Danh sách các nhóm bạn đã mở trên máy này. Chạm để chuyển nhanh mà không cần tìm lại link chat.
            </SheetDescription>
          </SheetHeader>

          {/* Groups List */}
          <div className="space-y-2 overflow-y-auto max-h-[50vh] pr-1 py-1">
            {visitedGroups.length === 0 ? (
              <div className="text-center p-6 border border-dashed rounded-xl text-xs text-muted-foreground">
                Chưa có nhóm nào được lưu. Khi bạn mở các link nhóm qua Zalo hay Telegram, nhóm sẽ tự động xuất hiện ở đây.
              </div>
            ) : (
              visitedGroups.map((g) => {
                const isCurrent = g.id === groupId;
                const emoji = getGroupEmoji(g);
                const savedMemberName =
                  typeof localStorage !== "undefined"
                    ? localStorage.getItem(scopedKey("lastSelectedMemberName", g.id))
                    : null;

                return (
                  <div
                    key={g.id}
                    onClick={() => handleSwitch(g.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer text-xs",
                      isCurrent
                        ? "bg-primary/5 border-primary/40 shadow-xs"
                        : "bg-card hover:bg-muted/50 border-border"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center text-lg shrink-0">
                        {emoji}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-semibold text-foreground truncate text-sm">
                          {g.name}
                        </p>
                        <div className="flex items-center gap-2 text-muted-foreground text-[11px] truncate">
                          {savedMemberName ? (
                            <span className="text-primary font-medium truncate">
                              Bạn: {savedMemberName}
                            </span>
                          ) : (
                            <span className="truncate">
                              {g.kind === "shared_bills" ? "Chia tiền dùng chung" : "Thể thao"}
                            </span>
                          )}
                          <span>•</span>
                          <span className="font-mono text-[10px]">/g/{g.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <Check className="h-3 w-3" />
                          Đang xem
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs font-medium text-primary hover:bg-primary/10"
                          onClick={() => handleSwitch(g.id)}
                        >
                          Chuyển <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}

                      {!isCurrent && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-full"
                          title="Xóa nhóm khỏi danh sách máy này"
                          onClick={(e) => handleRemove(e, g.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-2 border-t text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span>Mở bất kỳ link nhóm công khai nào trên Zalo/Telegram để tự động thêm nhóm đó vào app.</span>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

