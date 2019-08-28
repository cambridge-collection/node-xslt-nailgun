/**
 * Example of an interactive console app.
 */
package io.foldr.ngtesthost;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class Prompt {
	public static void main(String[] args) {
		try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
			System.out.println("What's your name?");
			System.out.print("> ");
			String name = in.readLine();

			System.out.println("What is your quest?");
			System.out.print("> ");
			String quest = in.readLine();

			System.out.format("Your name is %s and your quest is %s\n", name, quest);
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}
}
