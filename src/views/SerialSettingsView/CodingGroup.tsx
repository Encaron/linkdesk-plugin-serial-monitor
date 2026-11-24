/**
 * 收发设置——「编码」分组——E6#87b 从 views/SerialSettingsView.tsx 搬出（只搬不改）。
 */

import { useTranslation } from "react-i18next";
import { FormRow, SelectBox } from "@linkdesk/ui";
import type { SerialSession } from "../../hooks/useSerialSessions";
import { SERIAL_CODINGS } from "../../constants";
import type { SessionFormApi } from "./setters";

export interface CodingGroupProps {
  api: SessionFormApi;
  session: SerialSession;
}

export function CodingGroup({ api, session }: CodingGroupProps) {
  const { t } = useTranslation();
  const { mkSelect, mkSetter } = api;
  return (
    <div className="ldk-setting-group serial-monitor-setting-group">
      <div className="serial-monitor-setting-section-label">{t("编码")}</div>
      <FormRow label={t("接收模式")}>
        <SelectBox
          value={session.receiveMode}
          options={[
            { value: "text", label: t("文本") },
            { value: "hex", label: "HEX" },
          ]}
          onChange={(v) => mkSetter("receiveMode")(v)}
        />
      </FormRow>
      <FormRow label={t("接收编码")}>
        {mkSelect("receiveCoding", [
          ...SERIAL_CODINGS.map((c) => ({ value: c, label: c })),
          // D2：自动档只在接收侧（发送没有「自动编码」语义）；value 用 ASCII 哨兵，label 走 i18n
          { value: "auto", label: t("自动") },
        ])}
      </FormRow>
      <FormRow label={t("发送模式")}>
        <SelectBox
          value={session.sendMode}
          options={[
            { value: "text", label: t("文本") },
            { value: "hex", label: "HEX" },
          ]}
          onChange={(v) => mkSetter("sendMode")(v)}
        />
      </FormRow>
      <FormRow label={t("发送编码")}>
        <SelectBox
          value={session.sendCoding}
          options={[...SERIAL_CODINGS]}
          onChange={(v) => mkSetter("sendCoding")(v)}
          disabled={session.sendMode === "hex"}
        />
      </FormRow>
    </div>
  );
}
