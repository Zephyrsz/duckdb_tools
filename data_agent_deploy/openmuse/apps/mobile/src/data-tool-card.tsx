import { useContext, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import { semanticResultSchema } from "../../../packages/domain/src/rds";
import { BrowserRunContext } from "./browser-tool-card";
import { Button, Card, colors, ErrorNotice, s } from "./ui";

const cell = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

export function DataToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { active } = useContext(BrowserRunContext);
  const [showSql, setShowSql] = useState(false);
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  const parsed = semanticResultSchema.safeParse(value);
  const failure = z.object({ error: z.string() }).safeParse(value);
  const working = loading && active;
  const data = parsed.success ? parsed.data : undefined;
  const error = failure.success
    ? failure.data.error
    : !loading && !data
      ? "查询未返回有效结果"
      : data && !data.success
        ? "数据查询失败"
        : "";
  return (
    <Card style={{ padding: 16, gap: 12, width: "100%" }}>
      <View style={[s.row, { gap: 10 }]}>
        {working && <ActivityIndicator color={colors.blueDark} />}
        <Text style={s.heading}>
          {working ? "正在查询数据…" : loading ? "查询已停止" : error ? "查询失败" : "数据查询结果"}
        </Text>
      </View>
      <ErrorNotice error={error} />
      {!loading && data?.success && (
        <>
          {data.question ? (
            <Text selectable style={s.text}>
              {data.question}
            </Text>
          ) : null}
          <Text style={s.small}>
            {data.row_count} 行 · {data.execution_time.toFixed(3)} 秒 · 语义版本{" "}
            {data.semantic_revision}
          </Text>
          {data.row_count === 0 ? (
            <Text style={s.muted}>没有符合条件的数据。</Text>
          ) : (
            <ScrollView horizontal style={{ maxHeight: 380 }}>
              <ScrollView nestedScrollEnabled>
                <View style={s.row}>
                  {data.columns.map((name) => (
                    <Text key={name} style={[s.label, { width: 170, padding: 8 }]}>
                      {name}
                    </Text>
                  ))}
                </View>
                {(data.data || []).map((row) => (
                  <View
                    key={JSON.stringify(row)}
                    style={[s.row, { borderTopWidth: 1, borderTopColor: colors.line }]}
                  >
                    {data.columns.map((name) => (
                      <Text selectable key={name} style={[s.text, { width: 170, padding: 8 }]}>
                        {cell(row[name])}
                      </Text>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </ScrollView>
          )}
          {[...new Set(data.warnings)].map((warning) => (
            <Text key={warning} style={s.small}>
              {warning}
            </Text>
          ))}
          {data.sql && (
            <>
              <Button small onPress={() => setShowSql(!showSql)}>
                {showSql ? "收起 SQL" : "查看 SQL"}
              </Button>
              {showSql && (
                <Text selectable style={[s.small, { fontFamily: "monospace" }]}>
                  {data.sql}
                </Text>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
