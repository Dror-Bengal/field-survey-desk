"""Record one visit via the volunteer UI and verify its exact response in a manager session."""
import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def check(url, capture, clean, existing=None):
    with sync_playwright() as engine:
        browser = engine.chromium.launch()
        manager = browser.new_context(viewport={"width": 1280, "height": 760})
        field = browser.new_context(viewport={"width": 414, "height": 875}, has_touch=True, is_mobile=True,
                                    permissions=["geolocation"],
                                    geolocation={"latitude": 52, "longitude": -1, "accuracy": 8})
        desk, phone = manager.new_page(), field.new_page()
        errors = []
        for page in (desk, phone):
            page.on("pageerror", lambda error: errors.append(str(error)))
        def login(page, path, email):
            page.goto(url + path)
            page.locator('input[type=email]').fill(email)
            page.locator('input[type=password]').fill('FieldDemo2026!')
            page.locator('button[type=submit]').click()
        def capture_page(page, name):
            if capture:
                capture.mkdir(exist_ok=True, parents=True)
                page.mouse.move(0, 0)
                page.wait_for_timeout(400)
                page.screenshot(path=capture / (name + ".png"), animations="disabled")

        def response_list(page):
            return page.expect_response(lambda r: "/api/v1/admin/responses?" in r.url and r.status == 200)

        login(desk, "/admin", "manager@example.test")
        responses_tab = desk.get_by_role("button", name="Responses", exact=True)
        with response_list(desk) as listing:
            responses_tab.click()
        if existing:
            match = next(r for r in listing.value.json()["items"] if r["id"] == existing)
            assert match["notes"] == "Completed at the door."
            stored = desk.locator(f'tr[data-response-id="{existing}"]')
            for value in ["Morgan Lane", "Alex Reed", "Birch St. 12", "named voter", "A"]:
                expect(stored.get_by_role("cell", name=value, exact=True)).to_be_visible()
            capture_page(desk, "results")
            desk.get_by_role("button", name="Overview", exact=True).click()
            expect(desk.get_by_text("North District", exact=True)).to_be_visible()
            capture_page(desk, "overview")
            field.close()
            manager.close()
            browser.close()
            print(f"PASS: saved response {existing} visible after a new sign-in.")
            return
        before = listing.value.json()["page"]["total"]
        if clean:
            assert before == 0, before

        login(phone, "/surveyor", "volunteer@example.test")
        phone.get_by_text("Brookfield", exact=True).first.tap()
        phone.get_by_text("Browse", exact=True).tap()
        phone.get_by_text("Birch", exact=True).first.tap()
        address = phone.get_by_role("button").filter(has_text="Birch St. 12").last
        expect(address).to_be_visible()
        capture_page(phone, "route")
        address.tap()
        phone.get_by_text("Alex Reed", exact=True).tap()
        phone.get_by_text("List A", exact=True).tap()
        note = "Completed at the door."
        phone.locator("textarea").fill(note)
        phone.locator("textarea").blur()
        capture_page(phone, "survey")
        with phone.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/v1/responses")) as submitted:
            phone.get_by_role("button", name="Submit response").tap()
        assert submitted.value.status == 201, submitted.value.text()
        saved = submitted.value.json()["response_id"]
        expect(phone.get_by_text("Alex Reed", exact=True)).to_be_visible()

        with desk.expect_response(lambda r: "/api/v1/admin/dashboard" in r.url and r.status == 200) as summary:
            desk.get_by_role("button", name="Overview", exact=True).click()
        assert summary.value.json()["kpi"]["total_responses"] == before + 1
        expect(desk.get_by_text("North District",exact=True)).to_be_visible()
        capture_page(desk, "overview")
        with response_list(desk) as listing:
            responses_tab.click()
        data = listing.value.json()
        assert data["page"]["total"] == before + 1
        result = next(r for r in data["items"] if r["id"] == saved)
        assert result["notes"] == note
        row = desk.locator(f'tr[data-response-id="{saved}"]')
        for value in ["Morgan Lane", "Alex Reed", "Birch St. 12", "T1", "named voter", "A"]:
            expect(row.get_by_role("cell", name=value, exact=True)).to_be_visible()
        capture_page(desk, "results")
        assert not errors, errors
        field.close()
        manager.close()
        browser.close()
        print(f"PASS: response {saved}, dashboard {before} -> {before+1}, matching manager row and note.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:18798")
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--clean", action="store_true", help="Require a fresh edition with zero survey responses")
    parser.add_argument("--verify-id", help="Read a saved response from a fresh manager session")
    args = parser.parse_args()
    check(args.url.rstrip("/"), args.capture, args.clean, args.verify_id)
