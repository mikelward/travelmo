"use client";

import { CalendarExport, paths } from "@travelmo/core";
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

export type ExportLinks = { https: string; webcal: string; google: string };

// The same calendar three ways: to copy, for Apple Calendar (webcal opens
// its subscribe dialog), and for Google Calendar's add-by-link page.
export function exportLinks(token: string, base = parserUrl()): ExportLinks {
  const https = `${base}/cal/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}
