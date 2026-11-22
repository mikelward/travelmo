import { google } from "googleapis";

// Publishes JSON messages to one Pub/Sub topic as the parser's own service
// account (application-default credentials), which needs
// roles/pubsub.publisher on the topic (deploy/pubsub.sh grants it).
export function pubsubPublisher(topic: string): (message: unknown) => Promise<void> {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/pubsub"] });
  const pubsub = google.pubsub({ version: "v1", auth });
  return async (message) => {
    await pubsub.projects.topics.publish({
      topic,
      requestBody: { messages: [{ data: Buffer.from(JSON.stringify(message)).toString("base64") }] },
    });
  };
}
