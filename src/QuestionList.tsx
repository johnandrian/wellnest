// An appointment's questions to ask, in the user's order (convex/questions.ts): each numbered, the first three marked
// "Top 3" (the ones the dashboard shows), with Move up and Remove. Used in Visits and in Visit Prep.
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { colors, radius, themed, TOUCH } from "./theme";
import type { Strings } from "./i18n";

export const TOP_QUESTIONS = 3;

export function QuestionList({ id, questions, s, run }: { id: Id<"visits">; questions: string[]; s: Strings; run: (fn: () => Promise<unknown>) => void }) {
  const move = useMutation(api.questions.move);
  const remove = useMutation(api.questions.remove);
  return (
    <View style={styles.list}>
      {questions.map((q, i) => {
        const top = i < TOP_QUESTIONS;
        return (
          <View key={`${i}-${q}`} style={styles.row}>
            <View style={[styles.rank, top && styles.rankTop]} accessibilityLabel={top ? `${s.questionsTop}, ${i + 1}` : String(i + 1)}>
              <Text style={[styles.rankText, top && styles.rankTextTop]}>{i + 1}</Text>
            </View>
            <Text style={styles.text}>{q}</Text>
            {i > 0 && (
              <Tap style={styles.button} onPress={() => run(() => move({ id, index: i }))} accessibilityRole="button" accessibilityLabel={`${s.questionUp}: ${q}`}>
                <Ionicons name="arrow-up" size={16} color={colors.primary} />
              </Tap>
            )}
            <Tap style={styles.button} onPress={() => run(() => remove({ id, index: i }))} accessibilityRole="button" accessibilityLabel={`${s.remove}: ${q}`}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </Tap>
          </View>
        );
      })}
      {questions.length > TOP_QUESTIONS && <Text style={styles.note}>{s.questionsTopNote}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: TOUCH - 4 },
  rank: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  rankTop: { backgroundColor: colors.primary, borderColor: colors.primary },
  rankText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  rankTextTop: { color: colors.onPrimary },
  text: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.text },
  button: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 13, color: colors.muted, marginTop: 2 },
}));
