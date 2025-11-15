import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Star, Trophy, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { Share } from "@/pages/Pay";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface RatingProps {
  sharesToRate: Share[];
  onRatingComplete: (ratings: any[]) => void;
  ratedByMemberId: string;
  }
  
  const removeDiacritics = (str: string) => {
    if (!str) return "";
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  };
  
  interface Player {
    id: string;
    name: string;
  }

interface Team {
  id: string;
  name: string;
  members: Player[];
}

export const Rating = ({
  sharesToRate,
  onRatingComplete,
  ratedByMemberId,
}: RatingProps) => {
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);
  const [playerRatings, setPlayerRatings] = useState<{ [key: string]: string }>(
    {}
  );
  const [mvp, setMvp] = useState<string>("");
  const [allRatings, setAllRatings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMvpComboboxOpen, setIsMvpComboboxOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentShare = sharesToRate[currentMatchIndex];

  useEffect(() => {
    const fetchTeamData = async () => {
      if (!currentShare) return;
      setIsLoading(true);
      try {
        const matchRef = doc(db, "matches", currentShare.matchId);
        const matchSnap = await getDoc(matchRef);
        if (matchSnap.exists()) {
          const matchData = matchSnap.data();
          const teamsConfig = matchData.teamsConfig || [];
          const allMemberIds = teamsConfig.flatMap(
            (t: any) => t.members?.map((m: any) => m.id) || []
          );

          // Fetch all member names in one go
          const memberDocs = await Promise.all(
            allMemberIds.map((id: string) => getDoc(doc(db, "members", id)))
          );
          const memberMap = new Map(
            memberDocs.map((d) => [d.id, d.data()?.name || "Unknown"])
          );

          const populatedTeams = teamsConfig.map((teamConfig: any) => ({
            id: teamConfig.id,
            name: teamConfig.name,
            members: (teamConfig.members || [])
              .map((member: any) => ({
                id: member.id,
                name: memberMap.get(member.id),
              }))
              .filter((m: Player) => m.name !== "Unknown"),
          }));
          setTeams(populatedTeams);
        }
      } catch (error) {
        console.error("Error fetching team data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTeamData();
  }, [currentShare]);

  const handleRatingChange = (memberId: string, score: string) => {
    // Allow empty string to clear, or validate numeric input
    if (score === "" || (!isNaN(parseFloat(score)) && parseFloat(score) >= 0 && parseFloat(score) <= 10)) {
        setPlayerRatings((prev) => ({ ...prev, [memberId]: score }));
    }
  };

  const handleNext = () => {
    const currentRating = {
      matchId: currentShare.matchId,
      ratedByMemberId,
      playerRatings: Object.entries(playerRatings)
        .map(([memberId, score]) => ({
          memberId,
          score: parseFloat(score), // Convert to number before saving
        }))
        .filter(item => !isNaN(item.score)), // Ensure only valid numbers are saved
      mvpPlayerId: mvp,
    };

    const newAllRatings = [...allRatings, currentRating];
    setAllRatings(newAllRatings);

    // Reset for next match
    setPlayerRatings({});
    setMvp("");
    setTeams([]);

    if (currentMatchIndex < sharesToRate.length - 1) {
      setCurrentMatchIndex(currentMatchIndex + 1);
    } else {
      setIsSubmitting(true);
      onRatingComplete(newAllRatings);
      // isSubmitting will be reset when the parent component un-mounts this component
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const allPlayers = teams.flatMap((t) => t.members);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Đánh giá trận đấu ({currentMatchIndex + 1}/{sharesToRate.length})
        </CardTitle>
        <CardDescription>
          Trận ngày: {currentShare.matchDate}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Player Ratings */}
        <div className="space-y-4">
          <h3 className="font-semibold flex items-center">
            <Star className="w-4 h-4 mr-2" /> Chấm điểm cầu thủ
          </h3>
          {teams.map((team) => (
            <div key={team.id}>
              <h4 className="font-medium text-sm text-muted-foreground mb-2">
                {team.name}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {team.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between"
                  >
                    <Label htmlFor={`rating-${member.id}`}>{member.name}</Label>
                     <Input
                        id={`rating-${member.id}`}
                        type="number"
                        min="0"
                        max="10"
                        step="0.5"
                        value={playerRatings[member.id] || ""}
                        onChange={(e) => handleRatingChange(member.id, e.target.value)}
                        className="w-[80px]"
                        placeholder="Điểm"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* MVP Selection */}
        <div className="space-y-2">
          <h3 className="font-semibold flex items-center">
            <Trophy className="w-4 h-4 mr-2" /> Cầu thủ xuất sắc nhất trận
          </h3>
            <Popover open={isMvpComboboxOpen} onOpenChange={setIsMvpComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    {mvp
                      ? allPlayers.find((player) => player.id === mvp)?.name
                      : "Chọn MVP..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command
                     filter={(value, search) => {
                      const normalizedValue = removeDiacritics(value.toLowerCase());
                      const normalizedSearch = removeDiacritics(search.toLowerCase());
                      return normalizedValue.includes(normalizedSearch) ? 1 : 0;
                    }}
                  >
                    <CommandInput placeholder="Tìm cầu thủ..." />
                    <CommandList>
                        <CommandEmpty>Không tìm thấy cầu thủ.</CommandEmpty>
                        <CommandGroup>
                        {allPlayers.map((player) => (
                            <CommandItem
                            key={player.id}
                            value={player.name}
                            onSelect={() => {
                                setMvp(player.id);
                                setIsMvpComboboxOpen(false);
                            }}
                            >
                            <Check
                                className={`mr-2 h-4 w-4 ${
                                mvp === player.id ? "opacity-100" : "opacity-0"
                                }`}
                            />
                            {player.name}
                            </CommandItem>
                        ))}
                        </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
            </Popover>
        </div>

        <Button onClick={handleNext} className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : currentMatchIndex < sharesToRate.length - 1
            ? "Tiếp tục"
            : "Hoàn tất đánh giá"}
        </Button>
      </CardContent>
    </Card>
  );
};