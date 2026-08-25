package com.ruijing.plantmanagerpda;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private int dp(float value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }
    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setPadding(dp(16), dp(10), dp(16), dp(10));
        return view;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(15, 118, 110));
        showLogin();
    }

    private void showLogin() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setGravity(Gravity.CENTER); root.setPadding(dp(28), dp(28), dp(28), dp(28)); root.setBackgroundColor(Color.rgb(15, 23, 42));
        TextView title = text("PLANT MANAGER PDA", 26, Color.WHITE); title.setGravity(Gravity.CENTER); root.addView(title, new LinearLayout.LayoutParams(-1, dp(80)));
        root.addView(text("Sign in to release a locked work order", 16, Color.rgb(148, 163, 184)));
        EditText user = new EditText(this); user.setHint("Plant Manager ID"); user.setSingleLine(true); user.setTextColor(Color.WHITE); user.setHintTextColor(Color.rgb(148, 163, 184)); root.addView(user, new LinearLayout.LayoutParams(-1, dp(58)));
        EditText password = new EditText(this); password.setHint("Password"); password.setSingleLine(true); password.setInputType(0x81); password.setTextColor(Color.WHITE); password.setHintTextColor(Color.rgb(148, 163, 184)); root.addView(password, new LinearLayout.LayoutParams(-1, dp(58)));
        Button login = new Button(this); login.setText("LOGIN"); login.setTextColor(Color.WHITE); login.setBackgroundColor(Color.rgb(14, 116, 144)); root.addView(login, new LinearLayout.LayoutParams(-1, dp(58)));
        TextView hint = text("Plant Manager account required", 13, Color.rgb(248, 113, 113)); hint.setVisibility(View.GONE); root.addView(hint);
        login.setOnClickListener(v -> { if (user.getText().toString().trim().length() > 0 && password.getText().length() > 0) { showManagerPage(); } else { hint.setVisibility(View.VISIBLE); hint.setText("Enter Plant Manager ID and password"); } });
        setContentView(root);
    }

    private void showManagerPage() {

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(15, 23, 42));

        TextView header = text("PLANT MANAGER PDA\nWO RELEASE CONTROL", 20, Color.WHITE);
        header.setGravity(Gravity.CENTER_VERTICAL); header.setBackgroundColor(Color.rgb(15, 118, 110));
        root.addView(header, new LinearLayout.LayoutParams(-1, dp(92)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(14), dp(14), dp(14), dp(90));
        content.addView(text("Plant Manager\nRelease a WO selected by a PDA so another WO can be selected. This action is controlled by the Plant Manager.", 16, Color.WHITE));

        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(8), dp(8), dp(8), dp(8)); card.setBackgroundColor(Color.rgb(30, 41, 59));
        card.addView(text("LOCKED WORK ORDER", 13, Color.rgb(148, 163, 184)));
        card.addView(text("WO 26082040004", 23, Color.WHITE));
        card.addView(text("Status: RUNNING\nPDA: SMT MATERIAL LOADER\nLock owner: MATERIAL LOADER\nLock date: TODAY", 15, Color.rgb(226, 232, 240)));
        Button release = new Button(this); release.setText("RELEASE WO"); release.setTextColor(Color.WHITE); release.setTextSize(16); release.setBackgroundColor(Color.rgb(185, 28, 28));
        release.setOnClickListener(v -> { release.setEnabled(false); release.setText("WO RELEASED"); Toast.makeText(this, "WO 26082040004 released by Plant Manager", Toast.LENGTH_LONG).show(); });
        card.addView(release, new LinearLayout.LayoutParams(-1, dp(58)));
        content.addView(card, new LinearLayout.LayoutParams(-1, -2));

        Button refresh = new Button(this); refresh.setText("REFRESH WO LOCK STATUS"); refresh.setTextColor(Color.WHITE); refresh.setOnClickListener(v -> Toast.makeText(this, "WO lock status refreshed", Toast.LENGTH_SHORT).show());
        content.addView(refresh, new LinearLayout.LayoutParams(-1, dp(56)));
        scroll.addView(content); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }
}
