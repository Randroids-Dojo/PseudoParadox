using System.Collections.Generic;
using UnityEngine;

public class VariantMovement : MonoBehaviour
{

    public CharacterController controller;
    public Animator animator;
    public float speed = 6f;
    public Clock clock;
    public PlayerPositionManager playerPositionManager;
    public int instanceNumber;
    public GameObject targetPrefab;

    private Transform target;

    private Dictionary<string, Vector3> previousTimeToPositionDict;

    void Start()
    {
        previousTimeToPositionDict = playerPositionManager.timeMachine[instanceNumber - 1];
        transform.position = GetNewPosition();
        CreateAndPositionTargetToFollow();
    }

    void Update()
    {
        // ToDo: Animate and have the variant look in the direction they are walking
        StepTowardsNewPosition();
    }

    private void CreateAndPositionTargetToFollow()
    {
        target = Instantiate(targetPrefab).transform;
        target.transform.localScale = new Vector3(0.15f, 1.0f, 0.15f);
        target.transform.position = transform.position;
    }

    private Vector3 GetNewPosition()
    {
        string key = clock.clockText.text;
        if (previousTimeToPositionDict.ContainsKey(key))
        {
            return previousTimeToPositionDict[key];
        }
        else
        {
            DestroyImmediate(target.gameObject);
            DestroyPlayerClones();
        }

        return new Vector3(0, 0, 0);
    }

    private void StepTowardsNewPosition()
    {
        Vector3 newPosition = GetNewPosition();

        if (target != null) {
            target.position = newPosition;
            float step = speed * Time.deltaTime;
            transform.position = Vector3.MoveTowards(transform.position, target.position, step);
        }
    }

    private void DestroyPlayerClones()
    {
        GameObject[] playerClones = GameObject.FindGameObjectsWithTag("PlayerClone");
        foreach (GameObject playerClone in playerClones)
        {
            Destroy(playerClone.gameObject);
        }
    }
}
