import { NextRequest, NextResponse } from "next/server";

// GET: Check connector status
export async function GET() {
  // TODO: Check actual OAuth tokens in Supabase
  return NextResponse.json({
    connectors: {
      github: false,
      slack: false,
    },
  });
}

// POST: Initiate connector OAuth
export async function POST(request: NextRequest) {
  const { connector } = await request.json();

  // TODO: Return actual OAuth URLs
  const oauthUrls: Record<string, string> = {
    github: `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo,read:org`,
    slack: `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=channels:history,chat:write`,
  };

  const url = oauthUrls[connector];
  if (!url) {
    return NextResponse.json(
      { error: `Unknown connector: ${connector}` },
      { status: 400 }
    );
  }

  return NextResponse.json({ authUrl: url });
}
