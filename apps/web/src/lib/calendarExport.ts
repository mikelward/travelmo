"use client";

import { CalendarExport, exportLinks as coreExportLinks, paths, type ExportLinks } from "@travelmo/core";

export type { ExportLinks };
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { parserUrl } from "./api";
import { firestore } from "./firebase";

// The owner's export link; null when they have none.
export function useCalendarExport(uid: string): CalendarExport | null | undefined {
  const [record, setRecord] = useState<CalendarExport | null>();
  useEffect(() => {
    return onSnapshot(
      doc(firestore(), paths.calendarExport(uid)),
      (s) => {
        if (!s.exists()) return setRecord(null);
        const result = CalendarExport.safeParse(s.data());
        if (result.success) setRecord(result.data);
        else {
          console.error(`Malformed calendar export ${s.ref.path}`, result.error);
          setRecord(null);
        }
      },
      (error) => console.error("Calendar export subscription failed", error),
    );
  }, [uid]);
  return record;
}

// The export links from this deployment's parser.
export function exportLinks(token: string, base = parserUrl()): ExportLinks {
  return coreExportLinks(token, base);
}
