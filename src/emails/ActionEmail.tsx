import { Html, Head, Body, Container, Heading, Text, Button, Section } from "@react-email/components";

export interface ActionEmailProps {
  heading: string;
  body: string;
  url: string;
  cta: string;
}

/** A single call-to-action transactional email (verification / reset / invite). */
export function ActionEmail({ heading, body, url, cta }: ActionEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", backgroundColor: "#f6f6f6", padding: "24px 0" }}>
        <Container
          style={{
            maxWidth: "480px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            padding: "32px",
            borderRadius: "8px",
          }}
        >
          <Heading as="h2" style={{ margin: "0 0 12px" }}>
            {heading}
          </Heading>
          <Text style={{ color: "#333", lineHeight: "1.5" }}>{body}</Text>
          <Section style={{ margin: "24px 0" }}>
            <Button
              href={url}
              style={{
                backgroundColor: "#1a73e8",
                color: "#ffffff",
                padding: "10px 18px",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              {cta}
            </Button>
          </Section>
          <Text style={{ color: "#888", fontSize: "12px", lineHeight: "1.5" }}>
            If the button doesn't work, paste this link into your browser:
            <br />
            {url}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ActionEmail;
